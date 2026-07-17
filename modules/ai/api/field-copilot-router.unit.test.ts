// Unit tests for the field copilot router's core logic.
//
// Strategy: test the runAgentTurn + buildFieldTools + buildFieldPrompt composition WITHOUT
// importing the tRPC router (which chains through @/trpc/init → @mallet/shared/outbox →
// owner-client → config validator). This matches the pattern used in
// modules/ai/infra/tools/field-read-tools.test.ts.
//
// Key assertions:
//   - get_my_job tool result JSON has NO total/rate/cost keys for !seesPrice techs
//   - rate IS present when seesPrice=true
//   - total is NEVER in the output (always stripped)
//   - The fake LLM seam (ScriptedLlm, cloned from ai-router.int.test.ts) drives the turn

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asJobId } from "@mallet/shared/types";
import type { FieldToolScope, FieldToolDeps } from "../infra/tools/field-read-tools";
import { buildFieldTools } from "../infra/tools/field-read-tools";
import { buildFieldPrompt } from "../app/field-copilot-prompt";
import { runAgentTurn } from "../app/run-agent-turn";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock, AgentMessage } from "../domain/llm-client";

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that pull the mocked modules
// ---------------------------------------------------------------------------

vi.mock("@mallet/jobs", () => ({
  DrizzleJobRepository: vi.fn(),
  toJobSummaryDTO: vi.fn(),
}));

vi.mock("@mallet/settings", () => ({
  DrizzleSettingsRepository: vi.fn(),
}));

import { DrizzleJobRepository } from "@mallet/jobs";
import { toJobSummaryDTO } from "@mallet/jobs";

// ---------------------------------------------------------------------------
// Fake LLM (cloned from ai-router.int.test.ts)
// ---------------------------------------------------------------------------

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
const mkTurn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({ stopReason, blocks, usage });
const callTool = (id: string, name: string, input: unknown): AssistantTurn =>
  mkTurn("tool_use", [{ type: "tool_use", id, name, input }]);
const textTurn = (t: string): AssistantTurn => mkTurn("end_turn", [{ type: "text", text: t }]);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = asOrgId("00000000-0000-0000-0000-000000000001");
const JOB_ID = asJobId("00000000-0000-0000-0000-000000000003");

const usd = (cents: number) => ({ cents, currency: "USD" as const });

const makeSummaryDto = () => ({
  id: JOB_ID,
  num: "JOB-1",
  leadId: randomUUID(),
  sourceEstimateId: null,
  title: "Water heater replacement",
  svc: "plumbing",
  kind: "repair",
  status: "in_progress",
  assigneeUserId: randomUUID(),
  scheduledStart: "2026-07-17T09:00:00.000Z",
  total: usd(45000),
  notes: null,
  scope: null,
  callbackOf: null,
  callbackReason: null,
  checklist: null,
  requiredCerts: [],
  visits: [],
  createdAt: "2026-07-15T00:00:00.000Z",
  lines: [
    { id: randomUUID(), description: "Tank", quantity: 1, rate: usd(38000), cost: usd(22000), position: 0 },
  ],
  addons: [],
  verifyAnswers: [],
  photos: [],
});

const makeJob = () => ({
  props: { id: JOB_ID, callbackOf: null },
});

const makeDeps = (): FieldToolDeps => ({
  withTx: (_orgId, fn) => fn({} as Parameters<FieldToolDeps["withTx"]>[1] extends (tx: infer TX) => unknown ? TX : never),
});

const makeScope = (seesPrice: boolean): FieldToolScope => ({ orgId: ORG_ID, jobId: JOB_ID, seesPrice });

function mockClass<T extends abstract new (...a: never[]) => unknown>(
  ctor: T,
  instance: Partial<InstanceType<T>>,
): void {
  vi.mocked(ctor as unknown as new (...a: never[]) => unknown).mockImplementation(function () {
    return instance;
  });
}

// ---------------------------------------------------------------------------
// Tests: tool-use round trip with fake LLM
// ---------------------------------------------------------------------------

describe("field copilot — tool-use round trip with fake LLM", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(toJobSummaryDTO).mockClear();
  });

  it("get_my_job result has NO total/rate/cost keys when seesPrice=false", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue({ lines: [], addons: [], verifyAnswers: [], photos: [] }),
    });

    const llm = new ScriptedLlm([
      callTool("t1", "get_my_job", {}),
      textTurn("Here is your job summary."),
    ]);

    const fieldTools = buildFieldTools(makeDeps())(makeScope(false)); // seesPrice=false
    const metas = fieldTools.map((t) => t.meta);
    const execute = (name: string, input: unknown) => {
      const tool = fieldTools.find((t) => t.meta.name === name);
      if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
      return tool.execute(input);
    };

    const result = await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: false }),
      tools: metas,
      execute,
      userMessage: "what's on my job?",
      effort: "medium",
      maxIters: 6,
    });

    expect(result.status).toBe("completed");
    // The second LLM request carries the tool_results message
    expect(llm.requests).toHaveLength(2);
    const toolResultMsg = llm.requests[1]!.messages.find(
      (m: AgentMessage) => m.role === "user" && m.kind === "tool_results",
    );
    expect(toolResultMsg).toBeDefined();
    if (toolResultMsg?.kind === "tool_results") {
      const content = toolResultMsg.results[0]!.content;
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // total must not be present (always stripped)
      expect("total" in parsed, "total must not appear in get_my_job output").toBe(false);
      // rate must be null when seesPrice=false
      const lines = (parsed.lines ?? []) as Array<Record<string, unknown>>;
      for (const line of lines) {
        expect(line.rate, "rate must be null when !seesPrice").toBeNull();
        expect(line.cost, "cost must always be null").toBeNull();
      }
    }
  });

  it("get_my_job result has rate present (but no cost, no total) when seesPrice=true", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue({ lines: [], addons: [], verifyAnswers: [], photos: [] }),
    });

    const llm = new ScriptedLlm([
      callTool("t2", "get_my_job", {}),
      textTurn("The job has one line item."),
    ]);

    const fieldTools = buildFieldTools(makeDeps())(makeScope(true)); // seesPrice=true
    const metas = fieldTools.map((t) => t.meta);
    const execute = (name: string, input: unknown) => {
      const tool = fieldTools.find((t) => t.meta.name === name);
      if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
      return tool.execute(input);
    };

    await runAgentTurn({
      llm,
      system: buildFieldPrompt({ seesPrice: true }),
      tools: metas,
      execute,
      userMessage: "what are the lines?",
      effort: "medium",
      maxIters: 6,
    });

    const toolResultMsg = llm.requests[1]!.messages.find(
      (m: AgentMessage) => m.role === "user" && m.kind === "tool_results",
    );
    if (toolResultMsg?.kind === "tool_results") {
      const parsed = JSON.parse(toolResultMsg.results[0]!.content) as Record<string, unknown>;
      // total is NEVER present (always stripped by buildRedactedJobContext)
      expect("total" in parsed, "total must not appear even when seesPrice=true").toBe(false);
      // rate IS present when seesPrice=true
      const lines = (parsed.lines ?? []) as Array<Record<string, unknown>>;
      if (lines.length > 0) {
        expect(lines[0]!.rate, "rate must be present when seesPrice=true").not.toBeNull();
        // cost is ALWAYS stripped regardless
        expect(lines[0]!.cost, "cost is always null").toBeNull();
      }
    }
  });

  it("all 3 field tools are mutating=false (advise-only contract)", () => {
    const fieldTools = buildFieldTools(makeDeps())(makeScope(true));
    for (const tool of fieldTools) {
      expect(tool.meta.mutating, `${tool.meta.name} should not be mutating`).toBe(false);
    }
  });

  it("system prompt includes price-guardrail rule when seesPrice=false", () => {
    const prompt = buildFieldPrompt({ seesPrice: false });
    expect(prompt).toContain("PRICE RULE (strict)");
    expect(prompt).toContain("NEVER state, estimate, imply, or hint at prices");
  });

  it("system prompt allows rates when seesPrice=true", () => {
    const prompt = buildFieldPrompt({ seesPrice: true });
    expect(prompt).not.toContain("PRICE RULE (strict)");
    expect(prompt).toContain("You may refer to line rates");
  });
});
