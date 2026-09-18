import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@mallet/shared/observability";
import { call, CircuitBreaker } from "@mallet/platform/resilience";
import { LlmError } from "../domain/llm-client";
import type {
  LlmClient,
  LlmRequest,
  AgentMessage,
  AssistantBlock,
  AssistantTurn,
  StopReason,
  UserContentBlock,
} from "../domain/llm-client";

const MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 16_000;

// The ONLY file importing the Anthropic SDK. Implements the LlmClient port: maps the neutral
// transcript to the Messages API, streams the turn (opus-4-8 at effort produces long turns that can
// exceed non-streaming HTTP timeouts), and maps the result back. Adaptive thinking is set explicitly
// (it is OFF when omitted). Prompt caching: cache_control on the last system block + last tool so the
// frozen tools+system prefix is a cache hit every turn — the main pilot cost lever. The tool list
// MUST be byte-identical across tenants (RLS scopes at execution, never by varying the schema).
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly breaker = new CircuitBreaker("anthropic", { failureThreshold: 5, resetMs: 30_000 });

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 0 });
  }

  async next(request: LlmRequest): Promise<AssistantTurn> {
    const tools: Anthropic.Tool[] = request.tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      // Cache the whole tool-definitions prefix by breakpointing the last tool.
      ...(i === request.tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    let message: Anthropic.Message;
    try {
      message = await call(
        async () => {
          const stream = this.client.messages.stream({
            model: MODEL,
            max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
            thinking: { type: "adaptive" },
            ...(request.effort ? { output_config: { effort: request.effort } } : {}),
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            tools: tools.length > 0 ? tools : undefined,
            messages: request.messages.map(toMessageParam),
          });
          return stream.finalMessage();
        },
        { idempotent: false, timeoutMs: 180_000, breaker: this.breaker },
      );
    } catch (error) {
      // Map the SDK error to a safe, domain-typed failure. Log the provider detail server-side only
      // (status/type/request-id — never the request body, which could carry customer data); the
      // caller sees a generic, retryable-aware LlmError, not raw provider text.
      if (error instanceof Anthropic.APIError) {
        const status = error.status;
        logger.error({ provider: "anthropic", status, type: error.name, requestId: error.requestID }, "anthropic.api_error");
        const retryable = status === undefined || status === 429 || (typeof status === "number" && status >= 500);
        throw new LlmError(retryable);
      }
      logger.error({ provider: "anthropic", err: error instanceof Error ? error.name : "unknown" }, "anthropic.unknown_error");
      throw new LlmError(true);
    }

    return {
      stopReason: mapStopReason(message.stop_reason),
      blocks: message.content.map(fromContentBlock).filter((b): b is AssistantBlock => b !== null),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}

/** @internal exported for unit tests only */
export const toUserContentBlockParam = (b: UserContentBlock): Anthropic.ContentBlockParam => {
  if (b.type === "text") return { type: "text", text: b.text };
  return {
    type: "image",
    source: { type: "base64", media_type: b.mediaType, data: b.dataBase64 },
  };
};

/** @internal exported for unit tests only */
export const toMessageParam = (msg: AgentMessage): Anthropic.MessageParam => {
  if (msg.role === "user" && msg.kind === "text") return { role: "user", content: msg.text };
  if (msg.role === "user" && msg.kind === "user_blocks") {
    return { role: "user", content: msg.blocks.map(toUserContentBlockParam) };
  }
  if (msg.role === "user") {
    return {
      role: "user",
      content: msg.results.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolUseId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }
  return { role: "assistant", content: msg.blocks.map(toBlockParam) };
};

const toBlockParam = (b: AssistantBlock): Anthropic.ContentBlockParam => {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "thinking":
      return { type: "thinking", thinking: b.thinking, signature: b.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: b.data };
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
  }
};

// Keep only the blocks the loop understands; ignore server-tool/citation/etc. blocks we don't use.
const fromContentBlock = (b: Anthropic.ContentBlock): AssistantBlock | null => {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "thinking":
      return { type: "thinking", thinking: b.thinking, signature: b.signature };
    case "redacted_thinking":
      return { type: "redacted_thinking", data: b.data };
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    default:
      return null;
  }
};

const mapStopReason = (reason: Anthropic.Message["stop_reason"]): StopReason => {
  switch (reason) {
    case "tool_use":
    case "max_tokens":
    case "stop_sequence":
    case "refusal":
      return reason;
    default:
      return "end_turn"; // end_turn, pause_turn (unused — no server tools), or null
  }
};
