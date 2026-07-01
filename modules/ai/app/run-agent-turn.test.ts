import { describe, it, expect } from "vitest";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock } from "../domain/llm-client";
import type { ToolOutcome } from "../domain/tool";
import { runAgentTurn, type ToolMeta } from "./run-agent-turn";

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 };
const turn = (stopReason: AssistantTurn["stopReason"], blocks: AssistantBlock[]): AssistantTurn => ({ stopReason, blocks, usage });
const text = (t: string): AssistantTurn => turn("end_turn", [{ type: "text", text: t }]);
const callTool = (id: string, name: string, input: unknown): AssistantTurn =>
  turn("tool_use", [{ type: "text", text: `using ${name}` }, { type: "tool_use", id, name, input }]);

// Scripted model: returns the queued turns in order; records the requests it saw.
class FakeLlm implements LlmClient {
  public readonly requests: LlmRequest[] = [];
  constructor(private readonly turns: AssistantTurn[]) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.requests.push(request);
    const t = this.turns.shift();
    if (!t) throw new Error("FakeLlm ran out of scripted turns");
    return t;
  }
}

const TOOLS: ToolMeta[] = [
  { name: "customer_list", description: "list customers", inputSchema: { type: "object" }, mutating: false },
  { name: "quote_draft", description: "draft a quote", inputSchema: { type: "object" }, mutating: true },
];

// Records every tool the loop executes; returns a scripted outcome per tool.
const recordingExecute = (outcomes: Record<string, ToolOutcome> = {}) => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const execute = async (name: string, input: unknown): Promise<ToolOutcome> => {
    calls.push({ name, input });
    return outcomes[name] ?? { ok: true, summary: `${name} ok` };
  };
  return { calls, execute };
};

describe("runAgentTurn", () => {
  it("runs a read tool then completes with the model's answer", async () => {
    const llm = new FakeLlm([callTool("t1", "customer_list", { limit: 5 }), text("You have 3 customers.")]);
    const { calls, execute } = recordingExecute({ customer_list: { ok: true, summary: "Karen; Bob; Ann" } });

    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "list customers" });

    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.text).toBe("You have 3 customers.");
    expect(calls).toEqual([{ name: "customer_list", input: { limit: 5 } }]);
    // The tool_result was fed back to the model on the second call.
    expect(llm.requests[1]!.messages.some((m) => m.role === "user" && m.kind === "tool_results")).toBe(true);
  });

  it("PAUSES for approval before running a mutating tool (never executes it)", async () => {
    const llm = new FakeLlm([callTool("t9", "quote_draft", { leadId: "abc" })]);
    const { calls, execute } = recordingExecute();

    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "draft a quote" });

    expect(result.status).toBe("needs_approval");
    if (result.status === "needs_approval") {
      expect(result.pending).toEqual([{ toolUseId: "t9", tool: "quote_draft", input: { leadId: "abc" } }]);
      expect(result.assistantText).toContain("using quote_draft");
    }
    expect(calls).toHaveLength(0); // the mutating tool did NOT run
  });

  it("resumes and executes a mutating tool once the human approves it", async () => {
    const paused = await runAgentTurn({
      llm: new FakeLlm([callTool("t9", "quote_draft", { leadId: "abc" })]),
      system: "sys",
      tools: TOOLS,
      execute: recordingExecute().execute,
      userMessage: "draft a quote",
    });
    expect(paused.status).toBe("needs_approval");

    const { calls, execute } = recordingExecute({ quote_draft: { ok: true, summary: "Drafted EST-1001" } });
    const resumed = await runAgentTurn({
      llm: new FakeLlm([text("Done — drafted EST-1001.")]),
      system: "sys",
      tools: TOOLS,
      execute,
      priorMessages: paused.transcript,
      approvedToolUseIds: ["t9"],
    });

    expect(resumed.status).toBe("completed");
    expect(calls).toEqual([{ name: "quote_draft", input: { leadId: "abc" } }]); // now it ran
  });

  it("feeds a denied mutating tool back as an error without executing it", async () => {
    const paused = await runAgentTurn({
      llm: new FakeLlm([callTool("t9", "quote_draft", { leadId: "abc" })]),
      system: "sys",
      tools: TOOLS,
      execute: recordingExecute().execute,
      userMessage: "draft a quote",
    });
    const { calls, execute } = recordingExecute();
    const resumed = await runAgentTurn({
      llm: new FakeLlm([text("Okay, I won't draft it.")]),
      system: "sys",
      tools: TOOLS,
      execute,
      priorMessages: paused.transcript,
      deniedToolUseIds: ["t9"],
    });
    expect(resumed.status).toBe("completed");
    expect(calls).toHaveLength(0); // denied → not executed
  });

  it("feeds a tool error back to the model so it can self-correct", async () => {
    const llm = new FakeLlm([callTool("t1", "customer_list", {}), text("No customers yet.")]);
    const { execute } = recordingExecute({ customer_list: { ok: false, error: "database unavailable" } });
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "list" });
    expect(result.status).toBe("completed");
    const fedBack = llm.requests[1]!.messages.find((m) => m.role === "user" && m.kind === "tool_results");
    expect(fedBack && fedBack.kind === "tool_results" && fedBack.results[0]!.isError).toBe(true);
  });

  it("returns an unknown-tool error to the model rather than executing", async () => {
    const llm = new FakeLlm([callTool("t1", "nonexistent_tool", {}), text("Sorry, I can't do that.")]);
    const { calls, execute } = recordingExecute();
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "do a thing" });
    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(0);
  });

  it("caps runaway loops and returns a final tool-less synthesis", async () => {
    // The model always asks for another read tool while tools are offered; the loop must stop at
    // maxIters and make ONE final tool-LESS call (tools:[]) to synthesize.
    let n = 0;
    const llm: LlmClient = {
      async next(request: LlmRequest): Promise<AssistantTurn> {
        return request.tools.length === 0 ? text("final synthesis") : callTool(`t${(n += 1)}`, "customer_list", {});
      },
    };
    const { calls, execute } = recordingExecute();
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "loop", maxIters: 4 });
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.text).toBe("final synthesis");
    expect(calls.length).toBeLessThanOrEqual(4); // bounded — did not run away
  });

  it("surfaces a model refusal as a refused result", async () => {
    const llm = new FakeLlm([turn("refusal", [{ type: "text", text: "I can't help with that." }])]);
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "bad" });
    expect(result.status).toBe("refused");
  });
});
