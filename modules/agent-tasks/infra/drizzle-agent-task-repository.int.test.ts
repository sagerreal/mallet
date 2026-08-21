import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asAgentTaskId, asOrgId, asUserId, toPage } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleAgentTaskRepository } from "./drizzle-agent-task-repository";

// WHAT THE CROSS-ORG CASES BELOW DO AND DON'T PROVE.
//
// All three tables (agent_tasks, agent_task_messages, agent_tool_executions) are
// ENABLE + FORCE ROW LEVEL SECURITY, and the runtime role connects NOBYPASSRLS. Inside
// withTenant, Postgres appends `org_id = current_org_id()` to every statement whether or not
// the query carries its own `eq(orgId, ...)` predicate. So every "org B can't see/touch org A's
// row" assertion here proves COMBINED RLS + app-level isolation — the property that actually
// protects a customer — NOT that the adapter's own `eq(orgId, ...)` predicates are doing
// anything beyond what RLS already enforces on their own. Isolating that would require a
// connection that bypasses RLS, which is out of scope for this suite. The app-level predicates
// remain real defence in depth (and are what lets the composite indexes get used), but a green
// run here is not license to read them as unproven and remove them.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleAgentTaskRepository (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let ownerAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    // Assign each id the MOMENT its own insert resolves, not after both resolve — if org B's
    // insert throws (a flaky shared pooler mid-connect), org A's id must already be captured so
    // afterAll's per-org delete can still find and remove it instead of stranding it.
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRepo A ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRepo B ' || gen_random_uuid()) returning id`;
    orgBId = b!.id;
    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'owner@agentrepo.test', 'owner', false) returning id`;
    ownerAId = ow!.id;
  });

  afterAll(async () => {
    // Each org is dropped in its OWN statement, independently of whether the other id was ever
    // assigned. The previous version deleted both ids in one `IN (...)` statement guarded only by
    // `if (orgAId)`: if beforeAll committed org A and then threw before org B's insert landed
    // (a flaky shared pooler mid-connect is exactly the failure this hit), orgBId stayed "" and
    // the delete threw on invalid UUID syntax BEFORE removing org A — stranding it permanently in
    // the shared production database. A thrown delete here must not skip closing the pool either.
    const dropOrg = async (id: string): Promise<void> => {
      if (!id) return;
      try {
        await admin`delete from orgs where id = ${id}`;
      } catch (error) {
        // Surface it, but a cleanup failure for one org must never block the other org's cleanup
        // or leave the admin connection open.
        console.error(`agent-task repo test: failed to delete org ${id}`, error);
      }
    };
    await dropOrg(orgAId);
    await dropOrg(orgBId);
    if (admin) await admin.end({ timeout: 5 });
    await closeDb();
  });

  const repoFor = <T>(orgId: string, fn: (r: DrizzleAgentTaskRepository) => Promise<T>): Promise<T> => {
    const org = asOrgId(orgId);
    return withTenant(org, (tx) => fn(new DrizzleAgentTaskRepository(tx, org)));
  };

  it("creates a task and reads it back", async () => {
    const id = randomUUID();
    const created = await repoFor(orgAId, (r) =>
      r.create({
        id,
        title: "Follow up with the Hendersons",
        createdBy: asUserId(ownerAId),
        createdByRole: "owner",
        nextActionAt: new Date("2026-08-21T16:00:00Z"),
      }),
    );
    expect(created.props.status).toBe("working");
    expect(created.props.version).toBe(0);

    const found = await repoFor(orgAId, (r) => r.findById(asAgentTaskId(id)));
    expect(found?.props.title).toBe("Follow up with the Hendersons");
  });

  it("is invisible to another org", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's task", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const fromB = await repoFor(orgBId, (r) => r.findById(asAgentTaskId(id)));
    expect(fromB).toBeNull();
  });

  it("refuses a save whose version is stale", async () => {
    const id = randomUUID();
    const task = await repoFor(orgAId, (r) =>
      r.create({ id, title: "Versioned", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const first = task.needsYou("your call", new Date());
    const okSave = await repoFor(orgAId, (r) => r.save(first, 0));
    expect(okSave).toBe(true);

    // A second writer holding the same stale read must lose.
    const stale = task.needsYou("mine", new Date());
    const raced = await repoFor(orgAId, (r) => r.save(stale, 0));
    expect(raced).toBe(false);
  });

  it("save from another org matches no row and returns false", async () => {
    const id = randomUUID();
    const task = await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's task, guarded", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const patched = task.needsYou("owner B should never see this", new Date());

    const fromB = await repoFor(orgBId, (r) => r.save(patched, 0));
    expect(fromB).toBe(false);

    // The attempted cross-org write must not have touched org A's row.
    const stillA = await repoFor(orgAId, (r) => r.findById(asAgentTaskId(id)));
    expect(stillA?.props.version).toBe(0);
  });

  it("appends and replays the conversation in seq order", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "Chatty", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const taskId = asAgentTaskId(id);
    // Two messages in ONE transaction — created_at is identical for both, so only seq can order them.
    await repoFor(orgAId, async (r) => {
      await r.appendMessage(taskId, { role: "user", kind: "text", text: "first" });
      await r.appendMessage(taskId, {
        role: "assistant",
        kind: "assistant",
        blocks: [{ type: "text", text: "second" }],
      });
    });
    const messages = await repoFor(orgAId, (r) => r.loadMessages(taskId));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", kind: "text", text: "first" });
    expect(messages[1]?.role).toBe("assistant");
  });

  it("loadMessages returns nothing for another org's task", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's private chat", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const taskId = asAgentTaskId(id);
    await repoFor(orgAId, (r) => r.appendMessage(taskId, { role: "user", kind: "text", text: "org A only" }));

    const fromB = await repoFor(orgBId, (r) => r.loadMessages(taskId));
    expect(fromB).toHaveLength(0);
  });

  it("records an execution once, however many times it is replayed", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "Ledger", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const taskId = asAgentTaskId(id);
    const use = `toolu_${randomUUID()}`;
    await repoFor(orgAId, (r) =>
      r.recordExecution(taskId, { toolUseId: use, tool: "invoice_send", ok: true, summary: "Sent invoice 1042." }),
    );
    await repoFor(orgAId, (r) =>
      r.recordExecution(taskId, { toolUseId: use, tool: "invoice_send", ok: true, summary: "DIFFERENT" }),
    );
    const found = await repoFor(orgAId, (r) => r.findExecution(use));
    expect(found?.summary).toBe("Sent invoice 1042.");
  });

  it("recordExecution cannot attach a write to another org's task", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's task, ledger-guarded", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const taskId = asAgentTaskId(id);
    const use = `toolu_${randomUUID()}`;

    // Org B's writer stamps its OWN org_id on the new row, so RLS's WITH CHECK is satisfied —
    // but the composite FK ties every execution to an agent_tasks row with the SAME org_id, and
    // no such row exists for org B against this taskId, so the write cannot land at all.
    await expect(
      repoFor(orgBId, (r) =>
        r.recordExecution(taskId, { toolUseId: use, tool: "invoice_send", ok: true, summary: "should never land" }),
      ),
    ).rejects.toThrow();

    // Org A's ledger is untouched: nothing was recorded under this toolUseId by anyone.
    const stillNothing = await repoFor(orgAId, (r) => r.findExecution(use));
    expect(stillNothing).toBeNull();
  });

  it("findExecution returns nothing for another org's task", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's private ledger", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const taskId = asAgentTaskId(id);
    const use = `toolu_${randomUUID()}`;
    await repoFor(orgAId, (r) =>
      r.recordExecution(taskId, { toolUseId: use, tool: "invoice_send", ok: true, summary: "org A only" }),
    );

    const fromB = await repoFor(orgBId, (r) => r.findExecution(use));
    expect(fromB).toBeNull();
  });

  it("releases only the lease it holds", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "Leased", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const lease = randomUUID();
    await admin`update agent_tasks set lease_id = ${lease}, locked_until = now() + interval '5 minutes' where id = ${id}`;

    const wrong = await repoFor(orgAId, (r) => r.releaseLease(asAgentTaskId(id), randomUUID()));
    expect(wrong).toBe(false);

    const right = await repoFor(orgAId, (r) => r.releaseLease(asAgentTaskId(id), lease));
    expect(right).toBe(true);
  });

  it("releaseLease from another org matches no row and returns false", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A's leased task", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const lease = randomUUID();
    await admin`update agent_tasks set lease_id = ${lease}, locked_until = now() + interval '5 minutes' where id = ${id}`;

    const fromB = await repoFor(orgBId, (r) => r.releaseLease(asAgentTaskId(id), lease));
    expect(fromB).toBe(false);

    // The cross-org attempt must not have cleared org A's lease.
    const [row] = await admin<{ lease_id: string | null }[]>`select lease_id from agent_tasks where id = ${id}`;
    expect(row?.lease_id).toBe(lease);
  });

  it("list from another org never returns that org's tasks", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A-only, listed", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );

    const page = await repoFor(orgBId, (r) => r.list(toPage({ limit: 50, cursor: null })));
    expect(page.items).toHaveLength(0);
  });

  it("lists newest-updated-first", async () => {
    const olderId = randomUUID();
    const newerId = randomUUID();

    await repoFor(orgAId, (r) =>
      r.create({ id: olderId, title: "Older", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    // Force a distinct, earlier updated_at so this proves ORDER BY, not just insertion order.
    await admin`update agent_tasks set updated_at = now() - interval '1 hour' where id = ${olderId}`;

    await repoFor(orgAId, (r) =>
      r.create({ id: newerId, title: "Newer", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );

    const page = await repoFor(orgAId, (r) => r.list(toPage({ limit: 50, cursor: null })));
    const ids = page.items.map((task) => task.props.id as string);
    expect(ids.indexOf(newerId)).toBeLessThan(ids.indexOf(olderId));
  });

  it("countOpen from another org counts none of this org's open work", async () => {
    const id = randomUUID();
    await repoFor(orgAId, (r) =>
      r.create({ id, title: "A-only, open", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );

    // By this point in the suite org A unambiguously has open work (proven by the other tests),
    // so a non-zero result here would mean org B's count leaked across the tenant boundary.
    const fromB = await repoFor(orgBId, (r) => r.countOpen());
    expect(fromB).toBe(0);
  });

  it("countOpen excludes a task once it is done", async () => {
    const id = randomUUID();
    const task = await repoFor(orgAId, (r) =>
      r.create({ id, title: "About to finish", createdBy: asUserId(ownerAId), createdByRole: "owner", nextActionAt: new Date() }),
    );
    const before = await repoFor(orgAId, (r) => r.countOpen());

    const done = task.finish("wrapped up", new Date());
    if (!done.ok) throw new Error("unreachable: finish() cannot fail on a fresh working task");
    const saved = await repoFor(orgAId, (r) => r.save(done.value, 0));
    expect(saved).toBe(true);

    const after = await repoFor(orgAId, (r) => r.countOpen());
    expect(after).toBe(before - 1);
  });
});
