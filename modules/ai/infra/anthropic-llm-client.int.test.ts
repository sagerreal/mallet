import { describe, it, expect } from "vitest";
import { AnthropicLlmClient } from "./anthropic-llm-client";

// OPT-IN live smoke test against the real Anthropic API (costs a few tokens, is nondeterministic).
// Gated on an explicit AI_LIVE_TEST flag (NOT just ANTHROPIC_API_KEY, which lives in .env.local) so
// it never runs in the normal gate. Validates that the adapter's params (model, adaptive thinking,
// effort, streaming, cached system block) are accepted and a turn maps back correctly. To run:
//   AI_LIVE_TEST=1 pnpm test:int -- anthropic-llm-client.int
const live = Boolean(process.env.AI_LIVE_TEST && process.env.ANTHROPIC_API_KEY);
const suite = live ? describe : describe.skip;

suite("AnthropicLlmClient against live Anthropic", () => {
  it("completes a simple tool-less turn", async () => {
    const client = new AnthropicLlmClient(process.env.ANTHROPIC_API_KEY as string);
    const turn = await client.next({
      system: "You are terse. Answer in one word.",
      tools: [],
      messages: [{ role: "user", kind: "text", text: "Reply with exactly: pong" }],
      effort: "low",
      maxTokens: 2000,
    });
    expect(["end_turn", "max_tokens", "stop_sequence"]).toContain(turn.stopReason);
    const text = turn.blocks.find((b): b is Extract<typeof b, { type: "text" }> => b.type === "text");
    expect(text?.text.toLowerCase()).toContain("pong");
    expect(turn.usage.outputTokens).toBeGreaterThan(0);
  });
});
