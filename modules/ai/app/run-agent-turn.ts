import { logger } from "@mallet/shared/observability";
import type {
  LlmClient,
  LlmToolSpec,
  AgentMessage,
  AssistantBlock,
  ToolResultBlock,
  LlmUsage,
  Effort,
  UserContentBlock,
} from "../domain/llm-client";
import type { ToolOutcome } from "../domain/tool";

// Model-facing tool metadata + the `mutating` gate. The loop is generic: it knows only these specs
// and an `execute` fn — the concrete tool handlers (and their tenant tx) live in the composition root.
export interface ToolMeta {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly mutating: boolean;
}

// `toolUseId` is the provider's tool_use id for THIS call, not inferred from a closure — a later
// execution ledger keys replay-safety on it, and a single assistant turn can emit two tool_use
// blocks for the same tool name, so anything short of the real id would key the wrong call.
export type ExecuteTool = (name: string, input: unknown, toolUseId: string) => Promise<ToolOutcome>;

export interface PendingAction {
  readonly toolUseId: string;
  readonly tool: string;
  readonly input: unknown;
}

export interface RunAgentParams {
  readonly llm: LlmClient;
  readonly system: string;
  readonly tools: readonly ToolMeta[];
  readonly execute: ExecuteTool;
  readonly userMessage?: string; // a fresh turn
  /**
   * Facts the assistant always needs and can never guess — the org's name, today's date in ITS
   * timezone, and that timezone.
   *
   * Prepended to the FIRST user message, never to the system prompt: the system + tools prefix has
   * to stay byte-identical across tenants or the prompt cache misses on every turn, which would cost
   * more latency than this saves.
   *
   * It used to be a tool the model had to call, which meant a whole model round trip to learn three
   * facts two cheap queries already had — on every new conversation, before a single word reached
   * the user.
   */
  readonly contextPreamble?: string;
  readonly userBlocks?: readonly UserContentBlock[]; // optional image blocks prepended to the initial user turn
  readonly priorMessages?: readonly AgentMessage[]; // resume: prior transcript
  readonly approvedToolUseIds?: readonly string[]; // resume: mutating tool_use ids the human approved
  readonly deniedToolUseIds?: readonly string[]; // resume: ids the human declined (fed back as errors)
  readonly effort?: Effort;
  readonly maxIters?: number;
  /**
   * Called after each message is appended, before the next LLM round.
   *
   * The transcript otherwise exists only in memory until the turn returns, so a driver killed
   * mid-turn loses the tool results for writes that already committed — and the next attempt
   * re-executes them. A durable driver awaits this to persist as it goes. The interactive drivers
   * pass nothing and are unaffected.
   */
  readonly onProgress?: (message: AgentMessage) => Promise<void>;
}

export type AgentResult =
  | { readonly status: "completed"; readonly text: string; readonly transcript: AgentMessage[]; readonly usage: LlmUsage }
  | {
      readonly status: "needs_approval";
      readonly assistantText: string;
      readonly pending: PendingAction[];
      readonly transcript: AgentMessage[];
      readonly usage: LlmUsage;
    }
  | { readonly status: "refused"; readonly text: string; readonly transcript: AgentMessage[]; readonly usage: LlmUsage };

const MAX_ITERS_DEFAULT = 15;

const isToolUse = (b: AssistantBlock): b is Extract<AssistantBlock, { type: "tool_use" }> => b.type === "tool_use";

type ToolUseBlock = Extract<AssistantBlock, { type: "tool_use" }>;
type Resolution = { kind: "await"; awaiting: PendingAction[] } | { kind: "results"; results: ToolResultBlock[] };

// Resolve one assistant tool_use turn: pause if any mutating tool is not yet approved/denied,
// otherwise execute each tool and gather its result. Extracted from the loop to keep it simple.
const resolvePending = async (
  toolUses: readonly ToolUseBlock[],
  tools: readonly ToolMeta[],
  approved: ReadonlySet<string>,
  denied: ReadonlySet<string>,
  execute: ExecuteTool,
): Promise<Resolution> => {
  const metaOf = (name: string): ToolMeta | undefined => tools.find((t) => t.name === name);
  const awaiting = toolUses.filter((tu) => metaOf(tu.name)?.mutating && !approved.has(tu.id) && !denied.has(tu.id));
  if (awaiting.length > 0) {
    return { kind: "await", awaiting: awaiting.map((tu) => ({ toolUseId: tu.id, tool: tu.name, input: tu.input })) };
  }
  const results: ToolResultBlock[] = [];
  for (const tu of toolUses) {
    if (!metaOf(tu.name)) {
      results.push({ toolUseId: tu.id, content: `unknown tool: ${tu.name}`, isError: true });
    } else if (denied.has(tu.id)) {
      results.push({ toolUseId: tu.id, content: `the user declined to run ${tu.name}`, isError: true });
    } else {
      try {
        const outcome = await execute(tu.name, tu.input, tu.id);
        results.push(outcome.ok ? { toolUseId: tu.id, content: outcome.summary } : { toolUseId: tu.id, content: outcome.error, isError: true });
      } catch (error: unknown) {
        logger.error({ toolUseId: tu.id, tool: tu.name, err: error instanceof Error ? error.message : String(error) }, "agent.tool.threw");
        results.push({ toolUseId: tu.id, content: "the tool failed unexpectedly; try a different approach", isError: true });
      }
    }
  }
  return { kind: "results", results };
};
const textOf = (blocks: readonly AssistantBlock[]): string =>
  blocks.filter((b): b is Extract<AssistantBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
const addUsage = (a: LlmUsage, b: LlmUsage): LlmUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
});

// One agentic turn: call the model with the tools + running transcript, execute the tools it asks for,
// feed results back, and loop until it stops asking (or a guard trips). A mutating tool never runs
// without an explicit approval — the loop returns `needs_approval` and the caller resumes with the
// approved tool_use ids. Fresh runs and resumes share ONE code path: a transcript that ends in an
// unanswered assistant tool_use turn (a resume) is resolved first, exactly like a just-produced turn.
export const runAgentTurn = async (params: RunAgentParams): Promise<AgentResult> => {
  const specs: LlmToolSpec[] = params.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  const approved = new Set(params.approvedToolUseIds ?? []);
  const denied = new Set(params.deniedToolUseIds ?? []);
  const maxIters = params.maxIters ?? MAX_ITERS_DEFAULT;

  const messages: AgentMessage[] = [...(params.priorMessages ?? [])];
  // Appends AND reports in one step so a durable driver's persisted transcript can never diverge
  // from what the loop actually used to decide its next move.
  const append = async (message: AgentMessage): Promise<void> => {
    messages.push(message);
    if (params.onProgress) await params.onProgress(message);
  };
  // Only on a FRESH turn: on a resume the transcript already carries it, and repeating it would
  // grow the context every round for no gain.
  const preamble = messages.length === 0 && params.contextPreamble ? `${params.contextPreamble}\n\n` : "";
  if (params.userMessage) {
    if (params.userBlocks && params.userBlocks.length > 0) {
      // Multimodal initial turn: image blocks first, then the text prompt.
      const blocks: readonly UserContentBlock[] = [
        ...params.userBlocks,
        { type: "text", text: `${preamble}${params.userMessage}` },
      ];
      await append({ role: "user", kind: "user_blocks", blocks });
    } else {
      await append({ role: "user", kind: "text", text: `${preamble}${params.userMessage}` });
    }
  }
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  for (let i = 0; i < maxIters; i += 1) {
    const last = messages[messages.length - 1];
    const pendingTurn = last?.role === "assistant" && last.blocks.some(isToolUse) ? last : null;

    if (pendingTurn) {
      const resolution = await resolvePending(pendingTurn.blocks.filter(isToolUse), params.tools, approved, denied, params.execute);
      if (resolution.kind === "await") {
        return { status: "needs_approval", assistantText: textOf(pendingTurn.blocks), pending: resolution.awaiting, transcript: messages, usage };
      }
      await append({ role: "user", kind: "tool_results", results: resolution.results });
      continue;
    }

    const turn = await params.llm.next({ system: params.system, tools: specs, messages, effort: params.effort });
    usage = addUsage(usage, turn.usage);

    if (turn.stopReason === "refusal") {
      return { status: "refused", text: textOf(turn.blocks) || "The request was declined.", transcript: messages, usage };
    }
    // Reported before the tool_use case can hit `needs_approval` above (on the next iteration) —
    // that assistant turn is what the human is approving and what a resume replays, so a durable
    // driver must have it persisted before this function ever returns the halt.
    await append({ role: "assistant", kind: "assistant", blocks: turn.blocks });
    // Any tool_use (incl. a max_tokens turn cut off mid-tools) is resolved on the next iteration;
    // otherwise (end_turn / stop_sequence / plain max_tokens) the turn is complete.
    if (turn.blocks.some(isToolUse)) continue;
    return { status: "completed", text: textOf(turn.blocks), transcript: messages, usage };
  }

  return synthesizeFinal(params, messages, usage); // iteration cap hit
};

// The cap wrap-up: one final tool-LESS call so the user gets a summary, not a dangling loop. If the
// transcript ends in an unanswered assistant tool_use, answer each with a synthetic error result
// FIRST — otherwise the request carries a dangling tool_use (no matching tool_result) and the API
// rejects it (400). A refusal on the wrap-up is surfaced as refused, not a blank completion.
const synthesizeFinal = async (
  params: RunAgentParams,
  messages: AgentMessage[],
  priorUsage: LlmUsage,
): Promise<AgentResult> => {
  const tail = messages[messages.length - 1];
  if (tail?.role === "assistant" && tail.blocks.some(isToolUse)) {
    messages.push({
      role: "user",
      kind: "tool_results",
      results: tail.blocks.filter(isToolUse).map((tu) => ({ toolUseId: tu.id, content: "tool-use limit reached; this tool was not run", isError: true })),
    });
  }
  const finalTurn = await params.llm.next({
    system: params.system,
    tools: [],
    messages: [...messages, { role: "user", kind: "text", text: "You have reached the tool-use limit for this task. Summarize what you did and what still needs doing." }],
    effort: "low",
  });
  const usage = addUsage(priorUsage, finalTurn.usage);
  if (finalTurn.stopReason === "refusal") {
    return { status: "refused", text: textOf(finalTurn.blocks) || "The request was declined.", transcript: messages, usage };
  }
  return { status: "completed", text: textOf(finalTurn.blocks), transcript: messages, usage };
};
