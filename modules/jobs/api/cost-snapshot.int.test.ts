import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The cost snapshot, end to end against the live database.
 *
 * `job_visits.cost_rate_cents` is still STAMPED — the office marking a visit done settles what
 * that trip cost, and reopening it clears the stamp. Those two cases still pass and are still
 * worth keeping: the column is the record of what a finished trip cost.
 *
 * What it no longer DRIVES is job costing. Labour is read off the timesheet now (see
 * DrizzleLaborReader), which carries its OWN stamp: `time_entries.cost_rate_cents`, written when
 * the week is approved. Approval is when a week stops being editable, so it is when its cost is
 * final — the same property, at the moment a timesheet actually has one. Both halves are proved
 * below: an approved week survives a raise, and a draft week does not pretend to.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

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
    signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },
  },
});

const DAY = "2026-05-04";
const WEEK_END = "2026-05-10";

suite("cost snapshot (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let ownerId = "";
  let techId = "";
  let leadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CostSnap ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    const mkUser = async (role: string, rate: number | null) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role, is_field_crew, cost_rate_cents)
        values (${orgId}, gen_random_uuid(), 's-' || gen_random_uuid() || '@snap.test', 'Snap', ${role}, true, ${rate})
        returning id`;
      return u!.id;
    };
    ownerId = await mkUser("owner", null);
    techId = await mkUser("tech", 3200); // $32/h burdened

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Snap Customer') returning id`;
    leadId = l!.id;
  });

  afterAll(async () => {
    if (orgId) {
      // Both reference users with no ON DELETE, so they go before the org cascade reaches them.
      await admin`delete from time_entries where org_id = ${orgId}`;
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /** A job with one visit assigned to the tech, arrived but not yet finished. */
  const seedOpenVisit = async (num: string) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${num}, 'in_progress', 50000, ${techId}) returning id`;
    const [v] = await admin<{ id: string }[]>`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, started_at, duration_minutes, status, position)
      values (${orgId}, ${j!.id}, ${DAY}, ${techId}, ${`${DAY}T16:00:00Z`}, 120, 'in_progress', 1)
      returning id`;
    return { jobId: j!.id, visitId: v!.id };
  };

  const owner = () => appRouter.createCaller(ctxFor(ownerId, orgId, "owner"));

  const laborFor = async (num: string) => {
    const { items } = await owner().v1.jobs.laborByJob({ from: DAY, to: WEEK_END });
    return items.find((i) => i.num === num);
  };

  it("stamps the rate on the visit when the office marks it done", async () => {
    const { jobId, visitId } = await seedOpenVisit("SNAP-1");
    await admin`update job_visits set completed_at = null where id = ${visitId}`;

    await owner().v1.visits.setVisitStatus({ jobId, visitId, status: "complete" });

    const [row] = await admin<{ cost_rate_cents: number | null }[]>`
      select cost_rate_cents from job_visits where id = ${visitId}`;
    expect(row!.cost_rate_cents).toBe(3200);
  });

  /**
   * THE WHOLE POINT. Finish the visit at $32, then give the technician a raise to $60. The week
   * already worked must still cost what it cost.
   */
  /**
   * THE GAP, ASSERTED SO IT CANNOT BE FORGOTTEN. Costing multiplies hours by whatever the person
   * costs today, so the week somebody's rate changes, every week they have ever entered moves
   * with it. Stamping the rate at timesheet APPROVAL would fix this; nothing does it yet.
   */
  const seedJobBlock = async (num: string) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${num}, 'complete', 50000) returning id`;
    await admin`
      insert into time_entries (org_id, tech_user_id, job_id, work_date, kind, start_time, end_time, src, status)
      values (${orgId}, ${techId}, ${j!.id}, ${DAY}, 'job', '09:00', '11:00', 'manual', 'draft')`;
    return j!.id;
  };

  /**
   * THE PROPERTY, at the moment a timesheet has one. Without the stamp, the day anybody gets a
   * raise every job they ever touched re-prices itself and last quarter's margins move.
   */
  it("a raise does not re-price a week already approved", async () => {
    await seedJobBlock("SNAP-APPROVED");
    await owner().v1.timesheets.approveWeek({ techUserId: techId, dates: [DAY] });

    const before = await laborFor("SNAP-APPROVED");
    expect(before?.costCents).toBe(6400); // 2h at $32, settled

    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 6000 });

    const after = await laborFor("SNAP-APPROVED");
    expect(after?.hours).toBe(before?.hours);
    expect(after?.costCents).toBe(before?.costCents);

    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 3200 });
  });

  /**
   * The other half, and it is deliberate: hours still being edited have no settled cost, so they
   * price at what the person costs now. Freezing a draft would quote a rate nobody agreed to.
   */
  it("an unapproved week still prices at the current rate", async () => {
    await seedJobBlock("SNAP-DRAFT");
    expect((await laborFor("SNAP-DRAFT"))?.costCents).toBe(6400);

    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 6000 });
    expect((await laborFor("SNAP-DRAFT"))?.costCents).toBe(12_000);

    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 3200 });
  });

  it("clears the stamp when the visit is reopened — a reopened trip has no settled cost", async () => {
    const { jobId, visitId } = await seedOpenVisit("SNAP-3");
    await owner().v1.visits.setVisitStatus({ jobId, visitId, status: "complete" });
    await owner().v1.visits.setVisitStatus({ jobId, visitId, status: "pending" });

    const [row] = await admin<{ cost_rate_cents: number | null }[]>`
      select cost_rate_cents from job_visits where id = ${visitId}`;
    expect(row!.cost_rate_cents).toBeNull();
  });
});
