import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, asAgentTaskId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import { withTenant } from "@mallet/shared/db/tx";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock, ToolContext } from "@mallet/ai";
import { buildAgentTools, buildExecuteTool, type ExecutionLedger } from "@mallet/ai";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";
import { DrizzleAgentTaskRepository } from "../infra/drizzle-agent-task-repository";

// Capstone for the agent-tasks tRPC entry: the whole stack via createCaller — auth/RBAC, the
// use-case, the loop, the per-tool withTenant execution, the execution ledger, live RLS — with a
// SCRIPTED fake model (no real Anthropic call), so it is deterministic.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const turn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({ stopReason, blocks, usage });
const callTool = (id: string, name: string, input: unknown): AssistantTurn => turn("tool_use", [{ type: "tool_use", id, name, input }]);
const text = (t: string): AssistantTurn => turn("end_turn", [{ type: "text", text: t }]);

class ScriptedLlm implements LlmClient {
  public readonly requests: LlmRequest[] = [];
  constructor(private readonly turns: AssistantTurn[]) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request);
    const t = this.turns.shift();
    if (!t) throw new Error("ScriptedLlm out of turns");
    return t;
  }
}

const neverCalledLlm: LlmClient = {
  next: () => Promise.reject(new Error("the LLM must not be called — the guard should refuse first")),
};

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxWith = (orgId: string, role: Role, llmClient: LlmClient | null, userId?: string): Context => ({
  principal: { userId: asUserId(userId ?? randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: null,
    llmClient,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

suite("agent-tasks tRPC entry (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let orgCId = "";
  let ownerAId = "";
  let ownerCId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRouter A ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRouter B ' || gen_random_uuid()) returning id`;
    orgBId = b!.id;
    const [c] = await admin<{ id: string }[]>`insert into orgs (name) values ('AgentRouter C ' || gen_random_uuid()) returning id`;
    orgCId = c!.id;
    const [ownerA] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgAId}, gen_random_uuid(), 'owner@agentrouter-a.test', 'owner', false) returning id`;
    ownerAId = ownerA!.id;
    const [ownerC] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${orgCId}, gen_random_uuid(), 'owner@agentrouter-c.test', 'owner', false) returning id`;
    ownerCId = ownerC!.id;
  });

  afterAll(async () => {
    const dropOrg = async (id: string): Promise<void> => {
      if (!id) return;
      try {
        await admin`delete from orgs where id = ${id}`;
      } catch (error) {
        console.error(`agent-task router test: failed to delete org ${id}`, error);
      }
    };
    await dropOrg(orgAId);
    await dropOrg(orgBId);
    await dropOrg(orgCId);
    if (admin) await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("files a task, lists it, and reads it back with its instruction", async () => {
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await caller.v1.agentTasks.create({
      title: "Follow up with the Hendersons",
      instruction: "Ask whether they want to go ahead with the water heater quote.",
    });
    expect(created.status).toBe("working");
    expect(created.version).toBe(0);
    expect(created.nextActionAt).not.toBeNull();

    const listed = await caller.v1.agentTasks.list({});
    expect(listed.items.some((t) => t.id === created.id)).toBe(true);

    const got = await caller.v1.agentTasks.get({ taskId: created.id });
    expect(got.task.id).toBe(created.id);
    expect(got.messages).toHaveLength(1);
    expect(got.messages[0]).toMatchObject({ role: "user" });
    expect(got.messages[0]?.text).toContain("water heater quote");
    expect(got.pending).toHaveLength(0);
  });

  it("refuses a tech at every procedure — the employee is an office surface", async () => {
    const caller = appRouter.createCaller(ctxWith(orgAId, "tech", new ScriptedLlm([])));
    await expect(caller.v1.agentTasks.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.v1.agentTasks.create({ title: "t", instruction: "go" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.v1.agentTasks.reply({ taskId: randomUUID(), version: 0, text: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides another org's task as absent, not forbidden", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "A-only", instruction: "go" });

    const fromB = appRouter.createCaller(ctxWith(orgBId, "owner", new ScriptedLlm([])));
    await expect(fromB.v1.agentTasks.get({ taskId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      fromB.v1.agentTasks.reply({ taskId: created.id, version: 0, text: "hi" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      fromB.v1.agentTasks.close({ taskId: created.id, version: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers PRECONDITION_FAILED when the AI is not configured for this server", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "No AI", instruction: "go" });

    const noAi = appRouter.createCaller(ctxWith(orgAId, "owner", null, ownerAId));
    await expect(
      noAi.v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "hi" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a stale version on reply with a real sentence, not a bare code", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Stale", instruction: "go" });

    const replyCaller = appRouter.createCaller(ctxWith(orgAId, "owner", neverCalledLlm, ownerAId));
    await expect(
      replyCaller.v1.agentTasks.reply({ taskId: created.id, version: created.version + 1, text: "hi" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("typing") });
  });

  it("rejects a reply that carries neither text nor an approval, and one that carries both", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Shape", instruction: "go" });

    const replyCaller = appRouter.createCaller(ctxWith(orgAId, "owner", neverCalledLlm, ownerAId));
    await expect(
      replyCaller.v1.agentTasks.reply({ taskId: created.id, version: created.version }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      replyCaller.v1.agentTasks.reply({
        taskId: created.id,
        version: created.version,
        text: "hi",
        approvedToolUseIds: ["whatever"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an approval id that is not in this task's pending transcript", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Forged", instruction: "go" });

    // The forged-id check runs BEFORE any LLM call, so a stub that rejects if invoked proves the
    // guard fires first — this is not a "let it fail some other way" test.
    const replyCaller = appRouter.createCaller(ctxWith(orgAId, "owner", neverCalledLlm, ownerAId));
    await expect(
      replyCaller.v1.agentTasks.reply({
        taskId: created.id,
        version: created.version,
        approvedToolUseIds: ["toolu_never_existed"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("puts a replied-to task back to work, with a fresh next_action_at", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Chatty", instruction: "go" });

    const llm = new ScriptedLlm([text("Got it — I'll take a look.")]);
    const replyCaller = appRouter.createCaller(ctxWith(orgAId, "owner", llm, ownerAId));
    const replied = await replyCaller.v1.agentTasks.reply({
      taskId: created.id,
      version: created.version,
      text: "go ahead and check on this",
    });

    expect(replied.status).toBe("completed");
    expect(replied.task.status).toBe("working");
    expect(replied.task.nextActionAt).not.toBeNull();
    expect(replied.task.version).toBeGreaterThan(created.version);

    const got = await ownerCaller.v1.agentTasks.get({ taskId: created.id });
    expect(got.messages.some((m) => m.role === "user" && m.text === "go ahead and check on this")).toBe(true);
    expect(got.messages.some((m) => m.role === "assistant" && m.text.includes("take a look"))).toBe(true);
  });

  it("refuses to file past the open-task ceiling", async () => {
    await admin`insert into agent_tasks (org_id, title, status, created_by, created_by_role)
      select ${orgCId}, 'ceiling-' || gen_random_uuid(), 'working', ${ownerCId}, 'owner'
      from generate_series(1, 50)`;

    const caller = appRouter.createCaller(ctxWith(orgCId, "owner", new ScriptedLlm([]), ownerCId));
    await expect(
      caller.v1.agentTasks.create({ title: "one too many", instruction: "go" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // ---- the execution ledger: the reply/approve path is the first caller that can drive a
  // mutating tool to completion, so it is the first place this property is provable at all. ----

  it("approving a mutating tool commits its business write AND records it in the execution ledger", async () => {
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Ledger via approve", instruction: "stand by" });

    const taskText = `ledger-router-proof-${randomUUID()}`;
    const proposeLlm = new ScriptedLlm([callTool("toolu_propose", "task_create", { text: taskText })]);
    const proposed = await appRouter
      .createCaller(ctxWith(orgAId, "owner", proposeLlm, ownerAId))
      .v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "please add that follow-up task" });

    expect(proposed.status).toBe("needs_approval");
    expect(proposed.task.status).toBe("needs_you");

    const pendingView = await ownerCaller.v1.agentTasks.get({ taskId: created.id });
    expect(pendingView.pending).toHaveLength(1);
    expect(pendingView.pending[0]?.tool).toBe("task_create");
    expect(pendingView.pending[0]?.summary).toContain(taskText); // describeProposal, not a raw tool name
    const toolUseId = pendingView.pending[0]!.toolUseId;

    const approveLlm = new ScriptedLlm([text("Done — I created that task.")]);
    const approved = await appRouter
      .createCaller(ctxWith(orgAId, "owner", approveLlm, ownerAId))
      .v1.agentTasks.reply({ taskId: created.id, version: proposed.task.version, approvedToolUseIds: [toolUseId] });

    expect(approved.status).toBe("completed");
    expect(approved.task.status).toBe("working");

    // The business write landed...
    const rows = await admin<{ id: string }[]>`select id from tasks where org_id = ${orgAId} and text = ${taskText}`;
    expect(rows).toHaveLength(1);

    // ...and the SAME approve call recorded it in the execution ledger, backed by the exact
    // repository the router wires — this is the property that was dormant everywhere else in
    // Phase 1 (the runner never populates an approved-tool list on its own).
    const org = asOrgId(orgAId);
    const found = await withTenant(org, (tx) => new DrizzleAgentTaskRepository(tx, org).findExecution(toolUseId));
    expect(found?.ok).toBe(true);
    expect(found?.summary).toContain(taskText);
  });

  it(
    "ledger coupling, one level below the router: the ledger row and the tool's business write " +
      "commit in the SAME transaction — both land on success, and NEITHER survives when the " +
      "transaction fails after both writes ran",
    async () => {
      const org = asOrgId(orgAId);
      const created = await appRouter
        .createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId))
        .v1.agentTasks.create({ title: "Coupling proof", instruction: "stand by" });
      const taskId = asAgentTaskId(created.id);
      const taskCreateTool = buildAgentTools().find((t) => t.name === "task_create")!;

      const runInTenant = <T,>(fn: (ctx: ToolContext) => Promise<T>): Promise<T> =>
        withTenant(org, (tx) => {
          const deps = { bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null };
          const principal: Principal = { userId: asUserId(ownerAId), orgId: org, role: "owner" };
          return fn({ tx, orgId: org, principal, deps });
        });

      // --- happy path: both writes commit together ---
      const okToolUseId = `toolu_${randomUUID()}`;
      const okText = `ledger-coupling-ok-${okToolUseId}`;
      const okLedger: ExecutionLedger = {
        find: (id) => withTenant(org, (tx) => new DrizzleAgentTaskRepository(tx, org).findExecution(id)),
        record: (tx, execution) => new DrizzleAgentTaskRepository(tx, org).recordExecution(taskId, execution),
      };
      const okExecute = buildExecuteTool({ tools: [taskCreateTool], runInTenant, ledger: okLedger });
      const okOutcome = await okExecute("task_create", { text: okText }, okToolUseId);
      expect(okOutcome.ok).toBe(true);

      const okRows = await admin<{ id: string }[]>`select id from tasks where org_id = ${orgAId} and text = ${okText}`;
      expect(okRows).toHaveLength(1); // the business write committed
      const okFound = await withTenant(org, (tx) => new DrizzleAgentTaskRepository(tx, org).findExecution(okToolUseId));
      expect(okFound?.ok).toBe(true); // the ledger row committed in the SAME transaction

      // --- crash path: the transaction fails AFTER both writes ran, inside the SAME tx the tool's
      // business write used. If the two are truly coupled, Postgres rolls back BOTH. If the ledger
      // row were on a separate transaction (the bug this proves does not exist here), the business
      // write above it would have already committed on its own and would survive alone. ---
      const crashToolUseId = `toolu_${randomUUID()}`;
      const crashText = `ledger-coupling-crash-${crashToolUseId}`;
      const crashingLedger: ExecutionLedger = {
        find: (id) => withTenant(org, (tx) => new DrizzleAgentTaskRepository(tx, org).findExecution(id)),
        record: async (tx, execution) => {
          await new DrizzleAgentTaskRepository(tx, org).recordExecution(taskId, execution);
          throw new Error("simulated crash: after the ledger write, before the request completes");
        },
      };
      const crashingExecute = buildExecuteTool({ tools: [taskCreateTool], runInTenant, ledger: crashingLedger });
      await expect(crashingExecute("task_create", { text: crashText }, crashToolUseId)).rejects.toThrow(/simulated crash/);

      const crashRows = await admin<{ id: string }[]>`select id from tasks where org_id = ${orgAId} and text = ${crashText}`;
      expect(crashRows).toHaveLength(0); // the business write did NOT survive alone
      const crashFound = await withTenant(org, (tx) => new DrizzleAgentTaskRepository(tx, org).findExecution(crashToolUseId));
      expect(crashFound).toBeNull(); // the ledger row did NOT survive either — neither one without the other
    },
  );

  it("refuses a reply while the runner holds a live lease, and allows one once it has expired", async () => {
    const llm = new ScriptedLlm([text("this must never be reached")]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm, ownerAId));
    const created = await caller.v1.agentTasks.create({ title: "Leased", instruction: "chase them" });

    // Exactly the state the runner leaves a row in mid-wake: claimed, lease held, and NOT yet
    // saved — so the version still matches and the version check alone would let this reply
    // through. Both turns would then append to one transcript, and two consecutive assistant
    // turns is a hard provider rejection on every later wake.
    const heldBy = randomUUID();
    await admin`
      update agent_tasks set lease_id = ${heldBy}, locked_until = now() + interval '5 minutes'
      where id = ${created.id}`;

    await expect(
      caller.v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "any news?" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Refused before the model was ever called, and nothing was appended.
    expect(llm.requests).toHaveLength(0);
    const during = await caller.v1.agentTasks.get({ taskId: created.id });
    expect(during.messages).toHaveLength(1);

    // An EXPIRED lease is not a live worker. Refusing on it would strand the task behind a dead
    // lock nothing ever clears, so the same reply must now go through.
    await admin`
      update agent_tasks set locked_until = now() - interval '1 minute' where id = ${created.id}`;
    const replied = await caller.v1.agentTasks.reply({
      taskId: created.id,
      version: created.version,
      text: "any news?",
    });
    expect(replied.status).toBe("completed");
    expect(llm.requests).toHaveLength(1);
  });

  it("REFUSES a typed reply while a tool_use is unanswered — before any model call, and appends nothing", async () => {
    // THE MOST CONSEQUENTIAL REFUSAL ON THIS SURFACE. Artie proposes, the task goes needs_you, and
    // the owner types "yes, go ahead" instead of pressing Approve. Persisting that user message
    // strands the assistant tool_use with no matching tool_result, which the provider rejects
    // UNCONDITIONALLY — on this request and on every later one. The row would be permanently
    // unusable while reporting "temporarily unavailable", and because it sits in needs_you
    // (next_action_at null) no wake would ever revisit it.
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Prose over a proposal", instruction: "stand by" });

    const proposeLlm = new ScriptedLlm([callTool("toolu_prose_guard", "task_create", { text: `prose-guard-${randomUUID()}` })]);
    const proposed = await appRouter
      .createCaller(ctxWith(orgAId, "owner", proposeLlm, ownerAId))
      .v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "please add that follow-up" });
    expect(proposed.status).toBe("needs_approval");

    const before = await ownerCaller.v1.agentTasks.get({ taskId: created.id });
    expect(before.pending).toHaveLength(1);

    // neverCalledLlm proves the guard fires BEFORE the model — this is not "it failed some other way".
    const replyCaller = appRouter.createCaller(ctxWith(orgAId, "owner", neverCalledLlm, ownerAId));
    await expect(
      replyCaller.v1.agentTasks.reply({
        taskId: created.id,
        version: proposed.task.version,
        text: "yes, go ahead",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("approve or decline") });

    // Nothing was written: the transcript still ends in the unanswered tool_use, the proposal is
    // still answerable by Approve, and the version did not move.
    const after = await ownerCaller.v1.agentTasks.get({ taskId: created.id });
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]?.toolUseId).toBe(before.pending[0]?.toolUseId);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.task.version).toBe(proposed.task.version);

    // ...and the approval it was blocking still works, so the guard closes a hole without closing
    // the door.
    const approved = await appRouter
      .createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([text("Done.")]), ownerAId))
      .v1.agentTasks.reply({
        taskId: created.id,
        version: proposed.task.version,
        approvedToolUseIds: [before.pending[0]!.toolUseId],
      });
    expect(approved.status).toBe("completed");
  });

  it("two OVERLAPPING replies cannot both run: the second is refused before it executes anything", async () => {
    // `reply` is ownerOrOffice and holds the row across an LLM round trip, so two office users on
    // the shared "Needs you" queue (or one owner in two tabs) could both approve the same tool_use.
    // Each buildExecuteTool consults the ledger in its OWN transaction, so before the lease both
    // found nothing, both executed, and the unique (org_id, tool_use_id) silently swallowed the
    // second ledger row — two texts, or two payment records, with no error anywhere.
    const ownerCaller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await ownerCaller.v1.agentTasks.create({ title: "Double approval", instruction: "stand by" });

    const taskText = `double-approve-${randomUUID()}`;
    const proposeLlm = new ScriptedLlm([callTool("toolu_double", "task_create", { text: taskText })]);
    const proposed = await appRouter
      .createCaller(ctxWith(orgAId, "owner", proposeLlm, ownerAId))
      .v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "add that task" });
    expect(proposed.status).toBe("needs_approval");
    const pending = await ownerCaller.v1.agentTasks.get({ taskId: created.id });
    const toolUseId = pending.pending[0]!.toolUseId;

    // The winner is PARKED mid-turn on a gate, so the loser genuinely overlaps it rather than
    // arriving after it finished — which is the only interleaving that could double-execute.
    let reachedModel = (): void => {};
    const atModel = new Promise<void>((resolve) => {
      reachedModel = resolve;
    });
    let releaseWinner = (): void => {};
    const held = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const gatedLlm: LlmClient = {
      next: async () => {
        reachedModel();
        await held;
        return text("Done — I created that task.");
      },
    };

    const winner = appRouter
      .createCaller(ctxWith(orgAId, "owner", gatedLlm, ownerAId))
      .v1.agentTasks.reply({ taskId: created.id, version: proposed.task.version, approvedToolUseIds: [toolUseId] });

    await atModel; // the winner now holds the lease and is genuinely mid-turn

    const loserLlm = new ScriptedLlm([text("this must never be reached")]);
    await expect(
      appRouter
        .createCaller(ctxWith(orgAId, "owner", loserLlm, ownerAId))
        .v1.agentTasks.reply({ taskId: created.id, version: proposed.task.version, approvedToolUseIds: [toolUseId] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // THE ASSERTION THAT KILLS THE MUTANT: the loser never entered the loop at all. Without the
    // acquired lease it would have passed the version check (the winner has not settled yet) and
    // called its own model — the ledger replay would have hidden the double business write, but the
    // second concurrent turn is the defect, and this is what sees it.
    expect(loserLlm.requests).toHaveLength(0);

    releaseWinner();
    const settled = await winner;
    expect(settled.status).toBe("completed");

    // Exactly ONE business write, and exactly ONE ledger row.
    const rows = await admin<{ id: string }[]>`select id from tasks where org_id = ${orgAId} and text = ${taskText}`;
    expect(rows).toHaveLength(1);
    const [led] = await admin<{ n: number }[]>`
      select count(*)::int as n from agent_tool_executions
      where org_id = ${orgAId} and tool_use_id = ${toolUseId}`;
    expect(led?.n).toBe(1);

    // And the lease is RELEASED, not left fencing the runner out for the rest of the window.
    const [row] = await admin<{ lease_id: string | null; locked_until: string | null }[]>`
      select lease_id, locked_until from agent_tasks where id = ${created.id}`;
    expect(row?.lease_id).toBeNull();
    expect(row?.locked_until).toBeNull();
  });

  it("releases the lease even when the turn THROWS — a failed reply must not fence the runner out", async () => {
    const boom: LlmClient = {
      next: () => Promise.reject(new Error("provider exploded")),
    };
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", boom, ownerAId));
    const created = await caller.v1.agentTasks.create({ title: "Throwing reply", instruction: "stand by" });

    await expect(
      caller.v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "any news?" }),
    ).rejects.toThrow();

    const [row] = await admin<{ lease_id: string | null; locked_until: string | null }[]>`
      select lease_id, locked_until from agent_tasks where id = ${created.id}`;
    expect(row?.lease_id).toBeNull();
    expect(row?.locked_until).toBeNull();
  });

  it("refuses to close a task while the runner holds a live lease, so close and reply agree", async () => {
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([]), ownerAId));
    const created = await caller.v1.agentTasks.create({ title: "Closing under the runner", instruction: "go" });
    await admin`
      update agent_tasks set lease_id = ${randomUUID()}, locked_until = now() + interval '5 minutes'
      where id = ${created.id}`;

    await expect(
      caller.v1.agentTasks.close({ taskId: created.id, version: created.version }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Expired counts as absent here too, or a hard-killed worker would strand the task.
    await admin`update agent_tasks set locked_until = now() - interval '1 minute' where id = ${created.id}`;
    const closed = await caller.v1.agentTasks.close({ taskId: created.id, version: created.version });
    expect(closed.status).toBe("closed");
  });

  it("reports a lost race against the runner finishing the task as CONFLICT, not BAD_REQUEST", async () => {
    const llm = new ScriptedLlm([text("Here is where things stand.")]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm, ownerAId));
    const created = await caller.v1.agentTasks.create({ title: "Finished under me", instruction: "check in" });

    // The runner finishes the task while this reply's turn is in flight. withTranscriptBytes is
    // chained before resume() in the settle, so without its terminal no-op guard the aggregate's
    // refusal surfaced as BAD_REQUEST ("start a new one") — which the drawer has no recovery path
    // for, unlike CONFLICT.
    await admin`update agent_tasks set status = 'done', next_action_at = null where id = ${created.id}`;

    await expect(
      caller.v1.agentTasks.reply({ taskId: created.id, version: created.version, text: "still there?" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
