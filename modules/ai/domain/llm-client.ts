// The provider-agnostic seam over the chat/agent model. The loop depends on THIS, not the Anthropic
// SDK, so it is unit-testable with a fake and a different model could be slotted behind it. Message
// blocks are kept faithful enough to replay a model's own thinking/tool_use verbatim on the next turn
// (required by Claude), while staying a plain serializable shape (so a turn's transcript can round-trip
// to the client for human-approval resume).

export interface LlmToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>; // JSON Schema (from z.toJSONSchema)
}

// Assistant content blocks. thinking/redacted_thinking carry exactly what Claude needs to replay them
// on the following turn; modifying them is rejected by the API, so they are stored and echoed as-is.
export type AssistantBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly thinking: string; readonly signature: string }
  | { readonly type: "redacted_thinking"; readonly data: string }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input: unknown };

export interface ToolResultBlock {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

// One entry in the running conversation. A user turn is either the initial text or a batch of
// tool_results answering the assistant's tool_use blocks.
export type AgentMessage =
  | { readonly role: "user"; readonly kind: "text"; readonly text: string }
  | { readonly role: "user"; readonly kind: "tool_results"; readonly results: readonly ToolResultBlock[] }
  | { readonly role: "assistant"; readonly kind: "assistant"; readonly blocks: readonly AssistantBlock[] };

export type Effort = "low" | "medium" | "high";

export interface LlmRequest {
  readonly system: string;
  readonly tools: readonly LlmToolSpec[];
  readonly messages: readonly AgentMessage[];
  readonly effort?: Effort;
  readonly maxTokens?: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

// Exit on ANY non-tool_use reason, not just end_turn (a common loop bug). pause_turn is omitted — it
// only occurs with Anthropic SERVER tools, which this first-party agent does not use.
export type StopReason = "tool_use" | "end_turn" | "max_tokens" | "stop_sequence" | "refusal";

export interface AssistantTurn {
  readonly stopReason: StopReason;
  readonly blocks: readonly AssistantBlock[];
  readonly usage: LlmUsage;
}

// One model round-trip: given the running conversation + tools, produce the next assistant turn.
// The implementation owns streaming, prompt caching, adaptive thinking, and provider mapping.
export interface LlmClient {
  next(request: LlmRequest): Promise<AssistantTurn>;
}
