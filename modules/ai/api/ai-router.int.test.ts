import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, photoStorageGateway: null, llmClient, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
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

  it("gatherJobContext returns the lead's notes/texts/field findings with real counts", async () => {
    // Seed: notes on the lead, one inbound text, one job with a visit note.
    await admin`update leads set notes = 'gate code 4411', source = 'Angi' where id = ${leadAId}`;
    await admin`insert into messages (org_id, lead_id, direction, channel, body, from_number, to_number)
      values (${orgAId}, ${leadAId}, 'inbound', 'sms', 'water heater leaking from the bottom', '+15550001111', '+15550002222')`;
    const [job] = await admin<{ id: string }[]>`insert into jobs (org_id, lead_id, num, status, notes)
      values (${orgAId}, ${leadAId}, 'JOB-9001', 'scheduled', 'tank rusted through — recommend replace') returning id`;

    const llm = new ScriptedLlm([]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm));
    const ctx = await caller.v1.ai.gatherJobContext({ leadId: leadAId });

    expect(ctx.lead?.name).toBe("Karen Agent");
    expect(ctx.lead?.source).toBe("Angi");
    expect(ctx.counts.notes).toBe(1);
    expect(ctx.counts.texts).toBe(1);
    expect(ctx.counts.visitNotes).toBe(1);
    expect(ctx.messages[0]?.body).toContain("water heater leaking");
    expect(ctx.visitNotes[0]).toContain("tank rusted");

    // Unknown lead → NOT_FOUND; another org's caller can't see this lead either (RLS).
    await expect(caller.v1.ai.gatherJobContext({ leadId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    if (job) await admin`delete from jobs where id = ${job.id}`;
  });

  it("draftEstimate carries lead context + pricebook + won quotes into the prompt and returns real stage counts", async () => {
    // Seed a pricebook service, a labor rate, and an ACCEPTED estimate to act as the exemplar.
    await admin`insert into pricebook_items (org_id, label, unit_price_cents, active, labor_hours)
      values (${orgAId}, '40-gal water heater install', 165000, true, 3)`;
    await admin`insert into labor_rates (org_id, label, rate_cents_per_hour, kind)
      values (${orgAId}, 'Standard', 14500, 'hourly')`;
    const [wonEst] = await admin<{ id: string }[]>`insert into estimates (org_id, num, lead_id, status, accepted_at)
      values (${orgAId}, 'EST-9001', ${leadAId}, 'accepted', now()) returning id`;
    await admin`insert into estimate_lines (org_id, estimate_id, description, quantity, rate_cents, position)
      values (${orgAId}, ${wonEst!.id}, '40-gal water heater + haul away', 1, 180000, 1)`;
    // A confirmed shop rule scoped to this job's keywords — must reach the prompt + stage counts.
    await admin`insert into quoting_rules (org_id, rule, job_tag, status, source)
      values (${orgAId}, 'Include haul-away on every water heater swap', 'water heater', 'confirmed', 'manual')`;

    const llm = new ScriptedLlm([
      callTool("d1", "submit_estimate", { lines: [{ description: "Water heater swap", quantity: 1, unitPriceUsd: 1650 }] }),
    ]);
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", llm));
    const res = await caller.v1.ai.draftEstimate({ description: "replace 40-gal water heater", leadId: leadAId });

    expect(res.lines).toHaveLength(1);
    expect(res.stages.pricebook.services).toBeGreaterThanOrEqual(1);
    expect(res.stages.pricebook.laborRates).toBeGreaterThanOrEqual(1);
    expect(res.stages.wonQuotes.count).toBeGreaterThanOrEqual(1);
    expect(res.stages.wonQuotes.nums).toContain("EST-9001");
    expect(res.stages.jobInfo?.texts).toBeGreaterThanOrEqual(1);
    expect(res.stages.rules?.count).toBeGreaterThanOrEqual(1);

    // The prompt the model actually saw carries every context block.
    const system = llm.requests[0]!.system;
    expect(system).toContain("This shop's pricebook");
    expect(system).toContain("40-gal water heater install");
    expect(system).toContain("This shop's labor rates");
    expect(system).toContain("This shop's rules");
    expect(system).toContain("Include haul-away on every water heater swap");
    expect(system).toContain("Quotes this shop sent and WON");
    expect(system).toContain("The job — what we already know");
  });

  it("rejects a malformed resume transcript with BAD_REQUEST (not a 500)", async () => {
    const caller = appRouter.createCaller(ctxWith(orgAId, "owner", new ScriptedLlm([])));
    // Well-formed JSON, structurally invalid AgentMessage (no kind/results).
    await expect(caller.v1.ai.resume({ transcript: '[{"role":"user"}]', approvedToolUseIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.v1.ai.resume({ transcript: "not json", approvedToolUseIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---- forged-approval-id input hygiene (no DB required) --------------------------
//
// These tests exercise the id cross-check that fires BEFORE drive() is called, so
// no live database connection is needed. A structurally valid transcript containing
// a tool_use block is round-tripped through the router; the id check either passes
// (real id) or rejects (forged id) before any LLM or DB call is made.

const validToolUseTranscript = JSON.stringify([
  {
    role: "assistant",
    kind: "assistant",
    blocks: [{ type: "tool_use", id: "real_id_abc", name: "quote_draft", input: {} }],
  },
]);

// A minimal stub LLM and context that let the router proceed past auth/deps to the id check.
const stubLlmNeverCalled: LlmClient = {
  next: () => Promise.reject(new Error("LLM should not be called in forged-id tests")),
};
const stubOrgId = "00000000-0000-0000-0000-000000000001" as const;

function noDbCtx(): Context {
  const stubAuth: AuthProvider = {
    authenticate: async () => { throw new Error("unused"); },
  };
  return {
    principal: { userId: asUserId(randomUUID()), orgId: asOrgId(stubOrgId), role: "owner" } satisfies Principal,
    unmapped: null,
    tx: null,
    deps: {
      authProvider: stubAuth,
      bus: new InMemoryEventBus(),
      clock: systemClock,
      ids: uuidGenerator,
      paymentLinkGateway: null, photoStorageGateway: null,
      llmClient: stubLlmNeverCalled,
      apiKeyAuthenticator: { authenticate: async () => null },
      tokenVerifier: { verify: async () => null },
      signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
    },
  };
}

describe("ai resume — forged approval id rejection", () => {
  it("rejects a forged approvedToolUseId that is not in the transcript → BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(noDbCtx());
    await expect(
      caller.v1.ai.resume({
        transcript: validToolUseTranscript,
        approvedToolUseIds: ["FORGED_ID_NOT_IN_TRANSCRIPT"],
        deniedToolUseIds: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "approved/denied id not found in transcript" });
  });

  it("rejects a forged deniedToolUseId that is not in the transcript → BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(noDbCtx());
    await expect(
      caller.v1.ai.resume({
        transcript: validToolUseTranscript,
        approvedToolUseIds: [],
        deniedToolUseIds: ["ANOTHER_FORGED_ID"],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "approved/denied id not found in transcript" });
  });

  it("accepts a real approvedToolUseId that is present in the transcript (proceeds past the check)", async () => {
    // The real id IS in the transcript — the check passes. drive() then calls
    // withTenant which hits the DB. Since there's no DB here, it will throw a
    // connection error — but importantly NOT a BAD_REQUEST forged-id error.
    const caller = appRouter.createCaller(noDbCtx());
    const result = caller.v1.ai.resume({
      transcript: validToolUseTranscript,
      approvedToolUseIds: ["real_id_abc"],
      deniedToolUseIds: [],
    });
    // We expect it to fail (no DB), but NOT with the forged-id BAD_REQUEST.
    await expect(result).rejects.not.toMatchObject({ message: "approved/denied id not found in transcript" });
  });
});
