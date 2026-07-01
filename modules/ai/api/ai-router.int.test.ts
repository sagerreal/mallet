import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock } from "@mallet/ai";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Capstone for the agent's tRPC entry: the whole stack via createCaller — auth/RBAC, the loop, the
// per-tool withTenant execution, live RLS — with a SCRIPTED fake model (no real Anthropic call), so
// it's deterministic. Proves a tool runs under the caller's org (sees only its data) and that a
// mutating tool pauses for approval.
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

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxWith = (orgId: string, role: Role, llmClient: LlmClient): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, llmClient, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("ai agent tRPC entry (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('Agent A ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Karen Agent') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id = ${orgAId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("runs a read tool under the caller's org (RLS-scoped) and completes", async () => {
    const llm = new ScriptedLlm([callTool("c1", "customer_list", { limit: 10 }), text("You have 1 customer: Karen Agent.")]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm));

    const res = await caller.v1.ai.run({ message: "list our customers" });

    expect(res.status).toBe("completed");
    expect(res.text).toContain("Karen Agent");
    // The tool executed under withTenant(orgA): its result (fed back to the model) shows org A's lead.
    const toolResult = llm.requests[1]!.messages.find((m) => m.role === "user" && m.kind === "tool_results");
    expect(toolResult && toolResult.kind === "tool_results" && toolResult.results[0]!.content).toContain("Karen Agent");
    expect(toolResult && toolResult.kind === "tool_results" && toolResult.results[0]!.content).toContain(leadAId);
  });

  it("pauses for human approval before a mutating tool runs", async () => {
    const llm = new ScriptedLlm([
      callTool("q1", "quote_draft", { leadId: leadAId, lines: [{ description: "Labor", quantity: 2, rateCents: 15000 }] }),
    ]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm));

    const res = await caller.v1.ai.run({ message: "draft a quote for Karen" });

    expect(res.status).toBe("needs_approval");
    expect(res.pending).toHaveLength(1);
    expect(res.pending[0]!.tool).toBe("quote_draft");
    // No estimate was created (the mutating tool did not run).
    const estimates = await admin<{ id: string }[]>`select id from estimates where org_id = ${orgAId}`;
    expect(estimates).toHaveLength(0);
  });

  it("executes the mutating tool under RLS after approval (resume)", async () => {
    const run = new ScriptedLlm([
      callTool("q2", "quote_draft", { leadId: leadAId, lines: [{ description: "Labor", quantity: 2, rateCents: 15000 }] }),
    ]);
    const paused = await appRouter.createCaller(ctxWith(orgAId, "owner", run)).v1.ai.run({ message: "draft a quote" });
    expect(paused.status).toBe("needs_approval");

    const resumeLlm = new ScriptedLlm([text("Drafted the quote.")]);
    const resumed = await appRouter
      .createCaller(ctxWith(orgAId, "owner", resumeLlm))
      .v1.ai.resume({ transcript: paused.transcript, approvedToolUseIds: [paused.pending[0]!.toolUseId] });

    expect(resumed.status).toBe("completed");
    const estimates = await admin<{ id: string; org_id: string }[]>`select id, org_id from estimates where org_id = ${orgAId}`;
    expect(estimates).toHaveLength(1); // the approved tool ran, scoped to org A
  });

  it("rejects a malformed resume transcript with BAD_REQUEST (not a 500)", async () => {
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([])));
    // Well-formed JSON, structurally invalid AgentMessage (no kind/results).
    await expect(caller.v1.ai.resume({ transcript: '[{"role":"user"}]', approvedToolUseIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.v1.ai.resume({ transcript: "not json", approvedToolUseIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
