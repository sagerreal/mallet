import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { closeOwnerDb } from "@mallet/shared/db/owner-client";
import { closeDb } from "@mallet/shared/db/client";
import { claimDueTasks } from "./claim-due-tasks";

// This claim is GLOBAL by design (it is the one cross-tenant statement in the module) — it will
// pick up other tests' and the live DB's due rows, not just this file's. Every test therefore
// neutralises everything currently due before seeding its own, the same discipline
// shared/outbox/relay/relay.int.test.ts uses with its clearOutbox().
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.warn("claimDueTasks integration suite SKIPPED: APP_DATABASE_URL/DATABASE_URL not set.");
}

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

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`insert into orgs (name) values ('Claim ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'owner@claim.test', 'owner', false) returning id`;
    userId = u!.id;
  });

  beforeEach(async () => {
    // The claim is GLOBAL — it will pick up other tests' and the live DB's rows. Neutralise
    // everything currently due so assertions are about this test's rows only. Same discipline as
    // relay.int.test.ts's clearOutbox().
    await admin`update agent_tasks set next_action_at = null where next_action_at is not null`;
  });

  afterAll(async () => {
    // Each throwaway org is dropped in its OWN statement, independently of whether any other
    // cleanup step succeeded — a sibling test in this module got a review finding for a teardown
    // that could throw and abort before deleting anything, stranding a row in the shared
    // production database. Do not repeat it: catch, log, and keep going so the pool always closes.
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
    const id = await seed(null);
    await admin`update agent_tasks set next_action_at = now() - interval '1 minute' where id = ${id}`;

    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    const mine = claimed.find((c) => c.id === id);
    expect(mine).toBeDefined();
    expect(Object.keys(mine as object).sort()).toEqual(["attempts", "id", "orgId"]);
  });

  it("does not claim a task scheduled in the future", async () => {
    const id = await seed(null);
    await admin`update agent_tasks set next_action_at = now() + interval '1 hour' where id = ${id}`;
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(claimed.find((c) => c.id === id)).toBeUndefined();
  });

  it("does not claim a task that is not working", async () => {
    const id = await seed(null, "needs_you");
    await admin`update agent_tasks set next_action_at = now() - interval '1 minute' where id = ${id}`;
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(claimed.find((c) => c.id === id)).toBeUndefined();
  });

  it("stamps a lease so a second tick cannot take the same task", async () => {
    const id = await seed(null);
    await admin`update agent_tasks set next_action_at = now() - interval '1 minute' where id = ${id}`;

    const first = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(first.find((c) => c.id === id)).toBeDefined();

    const second = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(second.find((c) => c.id === id)).toBeUndefined();
  });

  it("reclaims a task whose lease expired", async () => {
    const id = await seed(null);
    await admin`
      update agent_tasks
      set next_action_at = now() - interval '1 minute',
          lease_id = gen_random_uuid(),
          locked_until = now() - interval '1 minute'
      where id = ${id}`;
    const claimed = await claimDueTasks({ batch: 10, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(claimed.find((c) => c.id === id)).toBeDefined();
  });

  it("honours the batch bound", async () => {
    for (let i = 0; i < 4; i += 1) {
      const id = await seed(null);
      await admin`update agent_tasks set next_action_at = now() - interval '1 minute' where id = ${id}`;
    }
    const claimed = await claimDueTasks({ batch: 2, leaseMinutes: 5, leaseId: randomUUID(), now: new Date() });
    expect(claimed).toHaveLength(2);
  });
});
