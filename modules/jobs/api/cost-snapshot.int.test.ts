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
 * The property under test is the one the unit tests cannot show: that a RAISE does not re-price
 * work already done. Costing used to multiply hours by whatever the person costs today, so the
 * week somebody's rate changed, every week they had ever worked moved with it.
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
  it("a raise does not re-price the week already worked", async () => {
    const { jobId, visitId } = await seedOpenVisit("SNAP-2");
    await admin`update job_visits set started_at = ${`${DAY}T16:00:00Z`} where id = ${visitId}`;
    await owner().v1.visits.setVisitStatus({ jobId, visitId, status: "complete" });

    const before = await laborFor("SNAP-2");
    expect(before?.costCents).toBeGreaterThan(0);

    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 6000 });

    const after = await laborFor("SNAP-2");
    expect(after?.costCents).toBe(before?.costCents);
    expect(after?.hours).toBe(before?.hours);

    // Put it back so the next case reads the original rate.
    await owner().v1.identity.setMemberCostRate({ userId: techId, costRateCents: 3200 });
  });

  /**
   * The fallback that keeps every visit finished before this shipped costable: no stamp, so the
   * reader uses the person's current rate — exactly the pre-snapshot behaviour, not a $0 job.
   */
  it("falls back to the current rate for a visit that carries no stamp", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, 'SNAP-LEGACY', 'complete', 50000) returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, started_at, completed_at, duration_minutes, status, position, cost_rate_cents)
      values (${orgId}, ${j!.id}, ${DAY}, ${techId}, ${`${DAY}T16:00:00Z`}, ${`${DAY}T18:00:00Z`}, 120, 'complete', 1, null)`;

    const row = await laborFor("SNAP-LEGACY");
    expect(row?.hours).toBe(2);
    expect(row?.costCents).toBe(6400); // 2h at the tech's CURRENT $32
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
