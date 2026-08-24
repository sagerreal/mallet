import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import { closeDb } from "@mallet/shared/db/client";
import { claimDueTasks } from "./claim-due-tasks";

// This claim is GLOBAL by design (it is the one cross-tenant statement in the module) — it WILL
// pick up other tests' and real production tasks' rows, not just this file's. This suite MUST
// NEVER mutate a row it did not create to force isolation (an earlier version nulled every due
// `next_action_at` in `beforeEach`; `next_action_at` is the field the runner reads to know when to
// wake a real task, there is no way to recover the value once nulled, and it runs against the
// shared production database — a live customer-facing AI task would have been silently
// unscheduled). Isolation instead comes from two things: every seeded row here uses an ANCIENT
// `next_action_at` far older than anything real (the claim's `ORDER BY next_action_at ASC` always
// sorts these first), and every assertion filters the result to this test's own `orgId` before
// checking anything, because the returned set legitimately contains other tenants' rows too.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn("claimDueTasks integration suite SKIPPED: APP_DATABASE_URL/DATABASE_URL not set.");
}

// Older than any real row could plausibly be. The claim's ORDER BY next_action_at ASC means a row
// stamped this far back sorts ahead of every other due row in the shared DB, real or seeded.
const ANCIENT = "1990-01-01T00:00:00Z";

suite("claimDueTasks", () => {
  let admin: Sql;
  let orgId = "";
  let userId = "";

  const seed = async (nextActionAt: string | null, status = "working"): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`
      insert into agent_tasks (org_id, title, status, next_action_at, created_by, created_by_role)
      values (${orgId}, 'claimable', ${status}, ${nextActionAt}, ${userId}, 'owner')
      returning id`;
    return row!.id;
  };

  // Every assertion filters through this first — the claim is global, so `claimed` legitimately
  // contains other tenants' rows and this test must never reason about the whole set.
  const mine = <T extends { orgId: string }>(claimed: readonly T[]): T[] => claimed.filter((c) => c.orgId === orgId);

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`insert into orgs (name) values ('Claim ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'owner@claim.test', 'owner', false) returning id`;
    userId = u!.id;
  });

  afterAll(async () => {
    // Each throwaway org is dropped in its OWN statement, independently of whether any other
    // cleanup step succeeded — a sibling test in this module got a review finding for a teardown
    // that could throw and abort before deleting anything, stranding a row in the shared
    // production database. Do not repeat it: catch, log, and keep going so the pool always closes.
    // (agent_tasks.org_id cascades on delete, so dropping the org also removes every seeded row.)
    const dropOrg = async (id: string): Promise<void> => {
      if (!id) return;
      try {
        await admin`delete from orgs where id = ${id}`;
      } catch (error) {
        console.error(`claimDueTasks test: failed to delete org ${id}`, error);
      }
    };
    await dropOrg(orgId);
    if (admin) await admin.end({ timeout: 5 });
    await closeOwnerDb();
    await closeDb();
  });

  it("claims a due task and returns ids only", async () => {
    const id = await seed(ANCIENT);

    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    const found = mine(claimed).find((c) => c.id === id);
    expect(found).toBeDefined();
    expect(Object.keys(found as object).sort()).toEqual(["attempts", "id", "orgId"]);
  });

  it("does not claim a task scheduled in the future", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const id = await seed(future);
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(mine(claimed).find((c) => c.id === id)).toBeUndefined();
  });

  it("does not claim a task that is not working", async () => {
    const id = await seed(ANCIENT, "needs_you");
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(mine(claimed).find((c) => c.id === id)).toBeUndefined();
  });

  it("stamps a lease so a second tick cannot take the same task", async () => {
    const id = await seed(ANCIENT);

    const first = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(mine(first).find((c) => c.id === id)).toBeDefined();

    const second = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(mine(second).find((c) => c.id === id)).toBeUndefined();
  });

  it("reclaims a task whose lease expired", async () => {
    const id = await seed(ANCIENT);
    // Targeted single-row update on a row this test created — not the global mutation this
    // suite forbids — to simulate a worker crash that stamped a lease and never released it.
    await admin`
      update agent_tasks
      set lease_id = gen_random_uuid(),
          locked_until = now() - interval '1 minute'
      where id = ${id}`;
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(mine(claimed).find((c) => c.id === id)).toBeDefined();
  });

  it("claims exactly the batch bound, and exactly the oldest rows, even when this org alone exceeds it", async () => {
    const batch = 2;
    // Strictly increasing next_action_at (one day apart, all still ANCIENT) so "the two oldest"
    // is unambiguous — ties would make that assertion meaningless.
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const at = new Date(Date.parse(ANCIENT) + i * 24 * 60 * 60 * 1000).toISOString();
      ids.push(await seed(at));
    }

    const claimed = await claimDueTasks({ batch, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    // The real contract: never more than batch, across ALL orgs — checked first since the shared
    // DB may legitimately hold other tenants' due rows too.
    expect(claimed.length).toBeLessThanOrEqual(batch);

    // This org alone seeded 4 rows older than anything else in the DB, so its own slice must be
    // capped at EXACTLY batch (not merely <= batch by luck) and must be the two oldest of the 4 —
    // proving the claim both bounds the batch and orders by next_action_at ascending.
    const mySlice = mine(claimed);
    expect(mySlice.map((c) => c.id).sort()).toEqual([ids[0], ids[1]].sort());
  });

  // REGRESSION (the batch bound). The original form of this claim,
  // `update ... where id in (select ... limit n for update skip locked)`, ignored the bound
  // entirely and leased EVERY due row: `limit 2` took all 6 candidates, and 20 candidates took all
  // 20. Postgres runs that sub-SELECT as a SubPlan re-executed once per candidate outer row, and
  // because SKIP LOCKED yields a different set on each execution nearly every row matches one of
  // them. Which plan the planner picks depends on the table's statistics, so the 4-row fixture
  // above caught it only intermittently — it passed on one run and failed on the next against
  // identical code. Twelve candidates against a batch of 3 is what made it deterministic when the
  // cause was measured, so that is what guards it.
  //
  // These rows are deleted at the end rather than left behind: the claim is GLOBAL, so nine
  // unclaimed rows dated older than every other suite's ANCIENT would sort ahead of them and could
  // starve a concurrently running suite's own claim.
  it("never leases more than the batch, with many more candidates than the bound", async () => {
    // Older than this file's ANCIENT, so these sort ahead of every other suite's seeded rows too
    // and the claimed set is unambiguously ours.
    const OLDEST = "1971-01-01T00:00:00Z";
    const batch = 3;
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(await seed(new Date(Date.parse(OLDEST) + i * 60 * 60 * 1000).toISOString()));
    }

    try {
      const claimed = await claimDueTasks({ batch, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });

      // The hard contract, across all orgs. Under the old statement this was 12, not 3.
      expect(claimed.length).toBeLessThanOrEqual(batch);
      // And ours specifically: these 12 are the oldest rows in the table, so the batch is all ours.
      expect(mine(claimed)).toHaveLength(batch);

      // The lease must be stamped on exactly `batch` rows — the returned set and the persisted
      // state have to agree, which is what the over-claim broke (it returned 12 AND leased 12).
      // Scoped to THIS test's ids, not to the org: earlier tests in this file lease rows in the
      // same org and those leases persist, so an org-wide count reads 8 rather than 3.
      const [leased] = await admin<{ n: number }[]>`
        select count(*)::int as n from agent_tasks
        where id = any(${ids}) and lease_id is not null`;
      expect(leased!.n).toBe(batch);
    } finally {
      await admin`delete from agent_tasks where id = any(${ids})`;
    }
  });

});
