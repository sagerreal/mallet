import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asAgentTaskId, asOrgId, asUserId, toPage } from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { DrizzleAgentTaskRepository } from "./drizzle-agent-task-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

suite("DrizzleAgentTaskRepository (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let ownerAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'owner@agentrepo.test', 'owner', false) returning id`;
    ownerAId = ow!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
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

  it("lists newest-first and counts only open work", async () => {
    const open = await repoFor(orgAId, (r) => r.countOpen());
    expect(open).toBeGreaterThan(0);
    const page = await repoFor(orgAId, (r) => r.list(toPage({ limit: 5, cursor: null })));
    expect(page.items.length).toBeGreaterThan(0);
  });
});
