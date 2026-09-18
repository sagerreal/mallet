import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// The tech-edit policy end to end against live RLS: the toggle, the submitted-week lock, the
// clock's exemption + auto-reopen, the time-off shape, and tenant isolation on submissions.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (userId: string, orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

/** Next week's Monday from the DB clock — hours land there without disturbing real data. */
const nextMonday = async (admin: Sql): Promise<string> => {
  const [row] = await admin<{ d: string }[]>`
    select to_char(current_date + (case when (8 - extract(dow from current_date)::int) % 7 = 0
                                        then 7 else ((8 - extract(dow from current_date)::int) % 7 + 7) % 7 end),
                   'YYYY-MM-DD') as d`;
  return row!.d;
};

suite("timesheet policy (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let techId = "";
  let ownerId = "";
  let monday = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TS Policy Org ' || gen_random_uuid()) returning id`;
    orgId = org!.id;
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('TS Policy Other ' || gen_random_uuid()) returning id`;
    otherOrgId = other!.id;
    const [t] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'tech@tspolicy.test', 'tech') returning id`;
    techId = t!.id;
    const [o] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'owner@tspolicy.test', 'owner') returning id`;
    ownerId = o!.id;
    monday = await nextMonday(admin);
  });

  afterAll(async () => {
    if (orgId) {
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from timesheet_submissions where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    if (otherOrgId) await admin`delete from orgs where id = ${otherOrgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("refuses a tech's hand edit while the org keeps edits off, allows the office, then opens with the toggle", async () => {
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
    const owner = appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));
    const entry = {
      techUserId: techId,
      workDate: monday,
      kind: "shop" as const,
      startTime: "08:00",
      endTime: "09:00",
    };

    // Default OFF: the tech is refused with the office named as the path.
    await expect(tech.v1.timesheets.create(entry)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The office is never gated by the toggle.
    const officeRow = await owner.v1.timesheets.create({ ...entry, startTime: "06:00", endTime: "07:00" });
    expect(officeRow.workDate).toBe(monday);

    // Toggle ON → the same tech write lands.
    await owner.v1.settings.updateConfig({ techEditsTimes: true });
    const row = await tech.v1.timesheets.create(entry);
    expect(row.startTime).toBe("08:00");
  });

  it("time off round-trips: a PTO day carries minutes and no punch times", async () => {
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
    const row = await tech.v1.timesheets.create({
      techUserId: techId,
      workDate: monday,
      kind: "pto",
      startTime: null,
      minutes: 480,
    });
    expect(row.kind).toBe("pto");
    expect(row.minutes).toBe(480);
    expect(row.startTime).toBeNull();
  });

  it("locks a submitted week for the tech, keeps the office free, and a clock tap reopens it", async () => {
    const tech = appRouter.createCaller(ctxFor(techId, orgId, "tech"));

    const submitted = await tech.v1.timesheets.submitWeek({ weekStart: monday });
    expect(submitted.reopenedAt).toBeNull();

    // Idempotent: the replay returns the standing attestation, no second row.
    await tech.v1.timesheets.submitWeek({ weekStart: monday });
    const [count] = await admin<{ n: string }[]>`
      select count(*) as n from timesheet_submissions where org_id = ${orgId} and tech_user_id = ${techId}`;
    expect(Number(count!.n)).toBe(1);

    // The tech's hand is locked out of the submitted week…
    await expect(
      tech.v1.timesheets.create({
        techUserId: techId, workDate: monday, kind: "shop", startTime: "10:00", endTime: "11:00",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

  });

  it("hours the OFFICE adds to a submitted week land AND reopen the attestation", async () => {
    // A second tech, submitting THIS week — the week the new hours file on.
    const [t2] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'tech2@tspolicy.test', 'tech') returning id`;
    const tech2 = appRouter.createCaller(ctxFor(t2!.id, orgId, "tech"));
    const [thisMonday] = await admin<{ d: string }[]>`
      select to_char(date_trunc('week', current_date)::date, 'YYYY-MM-DD') as d`;

    const sub = await tech2.v1.timesheets.submitWeek({ weekStart: thisMonday!.d });
    expect(sub.reopenedAt).toBeNull();

    // The OFFICE adds them. A technician writing into their own submitted week is refused — that
    // is what submitting means — so the office is the only route left, and it is exactly the route
    // that needs this: hours added on somebody's behalf, without them seeing. The property used to
    // live in the clock, which was exempt from the lock because a person genuinely working cannot
    // be refused; the clock is gone, so it moved to the only writer there is.
    const office = appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));
    await office.v1.timesheets.create({
      techUserId: t2!.id,
      workDate: thisMonday!.d,
      kind: "shop",
      jobId: null,
      startTime: "09:00",
      endTime: "11:00",
      note: "",
      src: "manual",
      running: false,
    });

    const after = await tech2.v1.timesheets.submissionFor({ weekStart: thisMonday!.d });
    expect(after.submission?.reopenedAt).not.toBeNull();
    expect(after.submission?.reopenReason).toContain("new hours");
  });

  it("persists an edit to a time-off row's length and its author (save() writes the whole row)", async () => {
    // A fresh tech: the shared `techId` has already SUBMITTED this week earlier in the suite, and
    // the lock would (correctly) refuse the edit before it reached the repository.
    const [t4] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'tech4@tspolicy.test', 'tech') returning id`;
    const techId4 = t4!.id;
    const tech = appRouter.createCaller(ctxFor(techId4, orgId, "tech"));
    const created = await tech.v1.timesheets.create({
      techUserId: techId4, workDate: monday, kind: "vacation", startTime: null, minutes: 480,
    });
    const patched = await tech.v1.timesheets.update({ entryId: created.id, minutes: 240 });
    expect(patched.minutes).toBe(240);
    // Straight from the database — the DTO could echo the domain object while the UPDATE dropped
    // the column, which is exactly the bug this proves is gone.
    const [row] = await admin<{ minutes: number; edited_by_user_id: string | null }[]>`
      select minutes, edited_by_user_id from time_entries where id = ${created.id}`;
    expect(row!.minutes).toBe(240);
    expect(row!.edited_by_user_id).toBe(techId4);
  });

  it("approves a week containing PAID TIME OFF — a day off is not unfinished hours", async () => {
    // The bug this pins: a time-off row has no end time BY CONSTRUCTION (the 0153 shape check),
    // so a kind-blind "unfinished" predicate made every week with PTO permanently unapprovable.
    const [t3] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'tech3@tspolicy.test', 'tech') returning id`;
    const techId3 = t3!.id;
    const owner = appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));

    await owner.v1.timesheets.create({
      techUserId: techId3, workDate: monday, kind: "holiday", startTime: null, minutes: 480,
    });
    await owner.v1.timesheets.create({
      techUserId: techId3, workDate: monday, kind: "shop", startTime: "08:00", endTime: "12:00",
    });

    const result = await owner.v1.timesheets.approveWeek({ techUserId: techId3, dates: [monday] });
    // BOTH rows approved: the worked stretch and the paid day off.
    expect(result.approved).toBe(2);
    const [approved] = await admin<{ n: string }[]>`
      select count(*) as n from time_entries
      where tech_user_id = ${techId3} and status = 'approved' and kind = 'holiday'`;
    expect(Number(approved!.n)).toBe(1);
  });

  it("keeps submissions tenant-isolated under RLS", async () => {
    // An OFFICE caller in the other org, naming org A's technician BY ID — the only shape that
    // actually exercises isolation. A tech caller is pinned to themselves by the router, so it
    // would return null even with the org predicate and the 0154 policy deleted.
    const [foreignOffice] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${otherOrgId}, ${randomUUID()}, 'office@other.test', 'office') returning id`;
    const outsider = appRouter.createCaller(ctxFor(foreignOffice!.id, otherOrgId, "office"));
    // techId holds an ACTIVE submission for `monday` (submitted earlier in this suite), so a leak
    // would return it.
    const seen = await outsider.v1.timesheets.submissionFor({ weekStart: monday, techUserId: techId });
    expect(seen.submission).toBeNull();
  });
});
