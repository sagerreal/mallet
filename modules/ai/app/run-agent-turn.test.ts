import { describe, it, expect } from "vitest";
import type { LlmClient, LlmRequest, AssistantTurn, AssistantBlock } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";
import type { ToolOutcome } from "../domain/tool";
import { runAgentTurn, type ToolMeta } from "./run-agent-turn";

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 };
const USAGE = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 };
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
// `toolUseIds` is a separate array (not folded into `calls`) so every existing `toEqual([{name,
// input}, ...])` assertion on `calls` keeps working unchanged.
const recordingExecute = (outcomes: Record<string, ToolOutcome> = {}) => {
  const calls: Array<{ name: string; input: unknown }> = [];
  const toolUseIds: string[] = [];
  const execute = async (name: string, input: unknown, toolUseId: string): Promise<ToolOutcome> => {
    calls.push({ name, input });
    toolUseIds.push(toolUseId);
    return outcomes[name] ?? { ok: true, summary: `${name} ok` };
  };
  return { calls, toolUseIds, execute };
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

  // A fake that ALSO validates tool_use/tool_result pairing like the real Anthropic API — it throws
  // if the transcript contains an assistant tool_use not immediately answered by a tool_results turn.
  // This is what catches a dangling-tool_use synthesis request (the odd-maxIters bug).
  const validatingAlwaysTool = (): LlmClient => {
    let n = 0;
    return {
      async next(request: LlmRequest): Promise<AssistantTurn> {
        request.messages.forEach((m, i) => {
          if (m.role === "assistant" && m.blocks.some((b) => b.type === "tool_use")) {
            const answer = request.messages[i + 1];
            if (!(answer && answer.role === "user" && answer.kind === "tool_results")) {
              throw new Error("400: assistant tool_use not answered by a tool_results turn");
            }
          }
        });
        return request.tools.length === 0 ? text("final synthesis") : callTool(`t${(n += 1)}`, "customer_list", {});
      },
    };
  };

  it("caps runaway loops and its final synthesis request has no dangling tool_use (odd maxIters)", async () => {
    // maxIters=3 (ODD) exits the loop right after a model-call iteration that left an unanswered
    // assistant tool_use. The validating fake would throw a 400 on the synthesis request if the loop
    // sent that dangling tool_use — so this both proves the cap and locks the dangling-tool_use fix.
    const { calls, execute } = recordingExecute();
    const result = await runAgentTurn({ llm: validatingAlwaysTool(), system: "sys", tools: TOOLS, execute, userMessage: "loop", maxIters: 3 });
    expect(result.status).toBe("completed");
    if (result.status === "completed") expect(result.text).toBe("final synthesis");
    expect(calls.length).toBeLessThanOrEqual(3); // bounded
  });

  it("surfaces a model refusal as a refused result", async () => {
    const llm = new FakeLlm([turn("refusal", [{ type: "text", text: "I can't help with that." }])]);
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "bad" });
    expect(result.status).toBe("refused");
  });

  it("surfaces a refusal on the final synthesis turn as refused (not a blank completion)", async () => {
    // maxIters=1: the loop makes one tool call, then the tool-less synthesis is refused by the model.
    const llm = new FakeLlm([callTool("t1", "customer_list", {}), turn("refusal", [{ type: "text", text: "Declined." }])]);
    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "x", maxIters: 1 });
    expect(result.status).toBe("refused");
  });

  it("propagates a provider LlmError for the router to map (not swallowed)", async () => {
    const llm: LlmClient = { next: async () => { throw new LlmError(true); } };
    await expect(runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "x" })).rejects.toBeInstanceOf(LlmError);
  });

  // ── userBlocks (multimodal) ──────────────────────────────────────────────────────────────────

  it("with userBlocks: the initial transcript entry is user_blocks with images first then text", async () => {
    const llm = new FakeLlm([text("Looks like a leaking pipe.")]);
    const result = await runAgentTurn({
      llm,
      system: "sys",
      tools: TOOLS,
      execute: recordingExecute().execute,
      userMessage: "What do you see?",
      userBlocks: [{ type: "image", mediaType: "image/jpeg", dataBase64: "abc==" }],
    });

    expect(result.status).toBe("completed");
    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.kind).toBe("user_blocks");
    if (firstMsg.kind === "user_blocks") {
      expect(firstMsg.blocks).toHaveLength(2);
      expect(firstMsg.blocks[0]).toEqual({ type: "image", mediaType: "image/jpeg", dataBase64: "abc==" });
      expect(firstMsg.blocks[1]).toEqual({ type: "text", text: "What do you see?" });
    }
  });

  it("without userBlocks: the initial transcript entry is a plain text message (existing behaviour unchanged)", async () => {
    const llm = new FakeLlm([text("Hello.")]);
    await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "hi" });

    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.kind).toBe("text");
    if (firstMsg.kind === "text") expect(firstMsg.text).toBe("hi");
  });

  it("with empty userBlocks array: falls back to plain text (no empty user_blocks message)", async () => {
    const llm = new FakeLlm([text("Hello.")]);
    await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "hi", userBlocks: [] });

    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.kind).toBe("text");
  });

  it("with userBlocks: multiple images are all prepended before the text block", async () => {
    const llm = new FakeLlm([text("I see two photos.")]);
    await runAgentTurn({
      llm,
      system: "sys",
      tools: TOOLS,
      execute: recordingExecute().execute,
      userMessage: "describe both",
      userBlocks: [
        { type: "image", mediaType: "image/jpeg", dataBase64: "img1==" },
        { type: "image", mediaType: "image/png", dataBase64: "img2==" },
      ],
    });

    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.kind).toBe("user_blocks");
    if (firstMsg.kind === "user_blocks") {
      expect(firstMsg.blocks).toHaveLength(3);
      expect(firstMsg.blocks[0]).toMatchObject({ type: "image", dataBase64: "img1==" });
      expect(firstMsg.blocks[1]).toMatchObject({ type: "image", dataBase64: "img2==" });
      expect(firstMsg.blocks[2]).toEqual({ type: "text", text: "describe both" });
    }
  });
  // ---- contextPreamble: the org facts, prefetched instead of asked for ----

  it("prepends the context preamble to the user's first message", async () => {
    const llm = new FakeLlm([text("Hello.")]);
    await runAgentTurn({
      llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute,
      userMessage: "how many customers do I have?",
      contextPreamble: "[Context: Summit Plumbing. Today is 2026-08-13.]",
    });

    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.kind).toBe("text");
    if (firstMsg.kind === "text") {
      expect(firstMsg.text).toBe("[Context: Summit Plumbing. Today is 2026-08-13.]\n\nhow many customers do I have?");
    }
  });

  it("does NOT repeat the preamble on a resumed turn — the transcript already carries it", async () => {
    // Every approval round trip re-enters this function. Re-prepending would stack a copy of the
    // org's context onto the conversation on each pass, growing the prompt for nothing.
    const llm = new FakeLlm([text("Done.")]);
    await runAgentTurn({
      llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute,
      priorMessages: [{ role: "user", kind: "text", text: "[Context: Summit Plumbing.]\n\nfirst question" }],
      userMessage: "follow-up",
      contextPreamble: "[Context: Summit Plumbing.]",
    });

    const sent = llm.requests[0]!.messages;
    const followUp = sent[sent.length - 1]!;
    if (followUp.kind === "text") expect(followUp.text).toBe("follow-up");
    expect(sent.filter((m) => m.kind === "text" && m.text.includes("[Context:"))).toHaveLength(1);
  });

  it("carries the preamble on a multimodal first turn too — a photo question still needs today's date", async () => {
    const llm = new FakeLlm([text("A leaking valve.")]);
    await runAgentTurn({
      llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute,
      userMessage: "what is this?",
      userBlocks: [{ type: "image", mediaType: "image/jpeg", dataBase64: "img==" }],
      contextPreamble: "[Context: Summit Plumbing.]",
    });

    const firstMsg = llm.requests[0]!.messages[0]!;
    expect(firstMsg.kind).toBe("user_blocks");
    if (firstMsg.kind === "user_blocks") {
      expect(firstMsg.blocks[1]).toEqual({ type: "text", text: "[Context: Summit Plumbing.]\n\nwhat is this?" });
    }
  });

  it("without a preamble the message is unchanged", async () => {
    const llm = new FakeLlm([text("Hello.")]);
    await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute: recordingExecute().execute, userMessage: "hi" });

    const firstMsg = llm.requests[0]!.messages[0]!;
    if (firstMsg.kind === "text") expect(firstMsg.text).toBe("hi");
  });

  // ── onProgress ───────────────────────────────────────────────────────────────────────────────

  it("reports each message as it is appended, in order", async () => {
    const llm = new FakeLlm([
      { stopReason: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "customer_list", input: {} }], usage: USAGE },
      { stopReason: "end_turn", blocks: [{ type: "text", text: "here they are" }], usage: USAGE },
    ]);
    const { execute } = recordingExecute({ customer_list: { ok: true, summary: "two customers" } });
    const seen: string[] = [];

    const result = await runAgentTurn({
      llm,
      system: "s",
      tools: [{ name: "customer_list", description: "d", inputSchema: {}, mutating: false }],
      execute,
      userMessage: "who are my customers",
      onProgress: async (m) => {
        seen.push(m.role === "assistant" ? "assistant" : m.kind);
      },
    });

    expect(result.status).toBe("completed");
    // The user's own message, the assistant's tool_use turn, the tool results, the final text.
    expect(seen).toEqual(["text", "assistant", "tool_results", "assistant"]);
  });

  it("reports the pending assistant turn before halting for approval", async () => {
    const llm = new FakeLlm([
      { stopReason: "tool_use", blocks: [{ type: "tool_use", id: "t1", name: "invoice_send", input: { invoiceId: "x" } }], usage: USAGE },
    ]);
    const { execute } = recordingExecute();
    const seen: string[] = [];

    const result = await runAgentTurn({
      llm,
      system: "s",
      tools: [{ name: "invoice_send", description: "d", inputSchema: {}, mutating: true }],
      execute,
      userMessage: "send it",
      onProgress: async (m) => {
        seen.push(m.role === "assistant" ? "assistant" : m.kind);
      },
    });

    expect(result.status).toBe("needs_approval");
    // The halt must not lose the assistant turn that proposed the write — it is what the human
    // is being asked to approve, and it is what the resume replays.
    expect(seen).toEqual(["text", "assistant"]);
  });

  // ── ExecuteTool's third argument ─────────────────────────────────────────────────────────────

  it("passes the provider's tool_use id as execute's third argument", async () => {
    // Two tool_use blocks in the SAME assistant turn, same tool name: only the real id (not a
    // closure-inferred one) can tell these two calls apart.
    const llm = new FakeLlm([
      turn("tool_use", [
        { type: "tool_use", id: "call-a", name: "customer_list", input: { page: 1 } },
        { type: "tool_use", id: "call-b", name: "customer_list", input: { page: 2 } },
      ]),
      text("done"),
    ]);
    const { toolUseIds, execute } = recordingExecute({ customer_list: { ok: true, summary: "ok" } });

    const result = await runAgentTurn({ llm, system: "sys", tools: TOOLS, execute, userMessage: "list all pages" });

    expect(result.status).toBe("completed");
    expect(toolUseIds).toEqual(["call-a", "call-b"]);
  });
});
