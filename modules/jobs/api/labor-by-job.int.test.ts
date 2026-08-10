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
 * v1.jobs.laborByJob against the live database.
 *
 * The rollup arithmetic is unit-tested in labor-rollup.test.ts; what can only be proved here is
 * the QUERY — that the week window picks the right visits, that the cost rate comes off the
 * VISIT's assignee rather than anyone else, and that RLS keeps another shop's hours out.
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

const MON = "2026-08-03";
const TUE = "2026-08-04";
const SUN = "2026-08-09";
/** The Monday AFTER the window — the row that proves the week boundary is real. */
const NEXT_MON = "2026-08-10";

suite("v1.jobs.laborByJob (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let ownerId = "";
  let cheapTechId = "";
  let pricyTechId = "";
  let leadId = "";

  const addJob = async (num: string, totalCents: number, org = orgId, lead = leadId) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${org}, ${lead}, ${num}, 'in_progress', ${totalCents}) returning id`;
    return j!.id;
  };

  const addVisit = async (
    jobId: string,
    v: { date: string | null; tech: string | null; started?: string | null; completed?: string | null; mins?: number; status?: string; org?: string },
  ) => {
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, started_at, completed_at, duration_minutes, status)
      values (${v.org ?? orgId}, ${jobId}, ${v.date}, ${v.tech}, ${v.started ?? null}, ${v.completed ?? null},
              ${v.mins ?? 120}, ${v.status ?? "complete"})`;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Costing ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CostingOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    const mkUser = async (org: string, role: string, rate: number | null) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role, is_field_crew, cost_rate_cents)
        values (${org}, gen_random_uuid(), 'c-' || gen_random_uuid() || '@costing.test',
                'Costing Crew', ${role}, true, ${rate})
        returning id`;
      return u!.id;
    };
    ownerId = await mkUser(orgId, "owner", null);
    cheapTechId = await mkUser(orgId, "tech", 3200); // $32/h burdened
    pricyTechId = await mkUser(orgId, "tech", 6000); // $60/h burdened

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Costing Customer') returning id`;
    leadId = l!.id;

    // Measured, 2.5h by the $32/h tech → $80.
    const measured = await addJob("C-MEASURED", 180_000);
    await addVisit(measured, { date: TUE, tech: cheapTechId, started: `${TUE}T16:00:00Z`, completed: `${TUE}T18:30:00Z` });

    // Two visits, two different people — proves the rate follows the VISIT's assignee.
    const twoCrew = await addJob("C-TWOCREW", 240_000);
    await addVisit(twoCrew, { date: MON, tech: cheapTechId, started: `${MON}T15:00:00Z`, completed: `${MON}T16:00:00Z` });
    await addVisit(twoCrew, { date: TUE, tech: pricyTechId, started: `${TUE}T15:00:00Z`, completed: `${TUE}T16:00:00Z` });

    // No taps, but it finished — falls back to the booked 2h and says so.
    const scheduled = await addJob("C-SCHEDULED", 90_000);
    await addVisit(scheduled, { date: TUE, tech: cheapTechId, mins: 120 });

    // Outside the window entirely.
    const nextWeek = await addJob("C-NEXTWEEK", 50_000);
    await addVisit(nextWeek, { date: NEXT_MON, tech: cheapTechId, started: `${NEXT_MON}T15:00:00Z`, completed: `${NEXT_MON}T17:00:00Z` });

    // Canceled — nobody travelled and nobody worked.
    const canceled = await addJob("C-CANCELED", 50_000);
    await addVisit(canceled, { date: TUE, tech: cheapTechId, started: `${TUE}T15:00:00Z`, completed: `${TUE}T17:00:00Z`, status: "canceled" });

    // Another shop's hours, on the same days.
    const [ol] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${otherOrgId}, 'Other Customer') returning id`;
    const otherJob = await addJob("C-OTHERORG", 99_000, otherOrgId, ol!.id);
    await addVisit(otherJob, { org: otherOrgId, date: TUE, tech: null, started: `${TUE}T15:00:00Z`, completed: `${TUE}T19:00:00Z` });
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      // job_visits_assignee_fk has no ON DELETE, so visits go before the org cascade reaches users.
      await admin`delete from job_visits where org_id = ${org}`;
      await admin`delete from orgs where id = ${org}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const week = () =>
    appRouter.createCaller(ctxFor(ownerId, orgId, "owner")).v1.jobs.laborByJob({ from: MON, to: SUN });

  it("measures the real span and costs it at the assignee's burdened rate", async () => {
    const row = (await week()).items.find((i) => i.num === "C-MEASURED");
    expect(row).toMatchObject({ visits: 1, hours: 2.5, costCents: 8000, source: "measured" });
    expect(row?.quotedCents).toBe(180_000);
    expect(row?.customerName).toBe("Costing Customer");
  });

  /**
   * The rate belongs to whoever ran THAT trip. Costing both hours at one person's rate — the
   * job's assignee, or the caller — is the quiet way a two-crew job reports the wrong margin.
   */
  it("takes each visit's rate from its own assignee: 1h at $32 + 1h at $60 = $92", async () => {
    const row = (await week()).items.find((i) => i.num === "C-TWOCREW");
    expect(row).toMatchObject({ visits: 2, hours: 2, costCents: 9200 });
  });

  it("falls back to the booked length when nobody tapped, and labels it scheduled", async () => {
    const row = (await week()).items.find((i) => i.num === "C-SCHEDULED");
    expect(row).toMatchObject({ hours: 2, source: "scheduled", costCents: 6400 });
  });

  it("keeps the week window: next Monday's visit is not in this week", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-NEXTWEEK");
  });

  it("ignores a canceled visit — nobody travelled and nobody worked", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-CANCELED");
  });

  it("never returns another shop's hours", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-OTHERORG");
  });

  /**
   * An unassigned visit still happened. Dropping it would make the job look cheaper than it was,
   * which is the one direction a costing report must never be wrong in.
   */
  it("counts an unassigned visit's hours, with no cost against them", async () => {
    const orphanJob = await addJob("C-ORPHAN", 40_000);
    await addVisit(orphanJob, { date: TUE, tech: null, started: `${TUE}T14:00:00Z`, completed: `${TUE}T15:30:00Z` });

    const row = (await week()).items.find((i) => i.num === "C-ORPHAN");
    expect(row).toMatchObject({ hours: 1.5, costCents: null, costIsPartial: false });
  });

  it("a tech is refused — labor cost is not a field surface", async () => {
    const caller = appRouter.createCaller(ctxFor(cheapTechId, orgId, "tech"));
    await expect(caller.v1.jobs.laborByJob({ from: MON, to: SUN })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
