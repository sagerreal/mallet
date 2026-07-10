import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { LlmClient, LlmRequest, AssistantTurn } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";
import { draftEstimateLines } from "./draft-estimate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 };

const toolUseTurn = (input: unknown): AssistantTurn => ({
  stopReason: "tool_use",
  blocks: [
    {
      type: "tool_use",
      id: "tu_1",
      name: "submit_estimate",
      input,
    },
  ],
  usage,
});

const textTurn = (text: string): AssistantTurn => ({
  stopReason: "end_turn",
  blocks: [{ type: "text", text }],
  usage,
});

/** A scripted fake that returns a pre-built turn and records the request. */
class FakeLlm implements LlmClient {
  public capturedRequest: LlmRequest | undefined;
  constructor(private readonly turn: AssistantTurn) {}
  async next(request: LlmRequest): Promise<AssistantTurn> {
    this.capturedRequest = request;
    return this.turn;
  }
}

const SAMPLE_TOOL_INPUT = {
  lines: [
    { description: "Labor — replace 40-gal water heater", quantity: 3, unitPriceUsd: 170 },
    { description: "40-gal gas water heater (Rheem)", quantity: 1, unitPriceUsd: 650 },
    { description: "Haul away & disposal", quantity: 1, unitPriceUsd: 75 },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("draftEstimateLines", () => {
  it("returns mapped lines (dollars → cents) when the model calls submit_estimate", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    const lines = await draftEstimateLines(llm, "replace 40-gal water heater, haul away, bring to code");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ description: "Labor — replace 40-gal water heater", quantity: 3, rateCents: 17000 });
    expect(lines[1]).toEqual({ description: "40-gal gas water heater (Rheem)", quantity: 1, rateCents: 65000 });
    expect(lines[2]).toEqual({ description: "Haul away & disposal", quantity: 1, rateCents: 7500 });
  });

  it("sends the user description as the first user message", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    const description = "replace kitchen faucet";

    await draftEstimateLines(llm, description);

    const req = llm.capturedRequest!;
    const firstMsg = req.messages[0];
    expect(firstMsg?.role).toBe("user");
    expect(firstMsg?.kind === "text" && firstMsg.text).toBe(description);
  });

  it("sends exactly one tool (submit_estimate) with a valid JSON schema", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    await draftEstimateLines(llm, "fix the toilet");

    const req = llm.capturedRequest!;
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0]!.name).toBe("submit_estimate");
    // inputSchema should be a plain object (no $schema key) with type "object"
    expect(req.tools[0]!.inputSchema).toMatchObject({ type: "object" });
    expect(req.tools[0]!.inputSchema).not.toHaveProperty("$schema");
  });

  it("uses effort: low", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    await draftEstimateLines(llm, "unclog drain");
    expect(llm.capturedRequest!.effort).toBe("low");
  });

  it("rounds fractional USD prices to whole cents", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        lines: [{ description: "Labor", quantity: 1, unitPriceUsd: 99.999 }],
      }),
    );
    const lines = await draftEstimateLines(llm, "any job");
    expect(lines[0]!.rateCents).toBe(10000); // Math.round(99.999 * 100)
  });

  it("falls back to JSON embedded in a text block when no tool_use block is present", async () => {
    const embeddedJson = JSON.stringify({
      lines: [
        { description: "Cable snake the drain", quantity: 1, unitPriceUsd: 295 },
        { description: "Camera inspection", quantity: 1, unitPriceUsd: 185 },
      ],
    });
    const llm = new FakeLlm(textTurn(`Here is the estimate:\n${embeddedJson}\nPlease review.`));

    const lines = await draftEstimateLines(llm, "clogged kitchen drain");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ description: "Cable snake the drain", quantity: 1, rateCents: 29500 });
    expect(lines[1]).toEqual({ description: "Camera inspection", quantity: 1, rateCents: 18500 });
  });

  it("throws TRPCError BAD_GATEWAY when the model returns no parseable output", async () => {
    const llm = new FakeLlm(textTurn("I am unable to produce an estimate at this time."));

    await expect(draftEstimateLines(llm, "something vague")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "AI couldn't draft an estimate — try rephrasing",
    });
  });

  it("throws TRPCError BAD_GATEWAY when submit_estimate tool_use carries invalid input", async () => {
    // tool_use block with the wrong shape (missing required fields)
    const llm = new FakeLlm(toolUseTurn({ wrong: "shape" }));

    await expect(draftEstimateLines(llm, "water heater")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  it("propagates a retryable LlmError as-is (router maps it to TOO_MANY_REQUESTS)", async () => {
    const llm: LlmClient = {
      next: async () => { throw new LlmError(true, "rate limited"); },
    };
    await expect(draftEstimateLines(llm, "any job")).rejects.toBeInstanceOf(LlmError);
  });

  it("propagates a non-retryable LlmError as-is (router maps it to BAD_GATEWAY)", async () => {
    const llm: LlmClient = {
      next: async () => { throw new LlmError(false, "provider error"); },
    };
    await expect(draftEstimateLines(llm, "any job")).rejects.toBeInstanceOf(LlmError);
  });
});

// ---------------------------------------------------------------------------
// Router-level wiring: the BAD_GATEWAY thrown from draftEstimateLines is a
// TRPCError, not a plain Error. Confirm it is an instance of TRPCError so the
// router transmits the right HTTP status without re-wrapping.
// ---------------------------------------------------------------------------

describe("TRPCError shape (BAD_GATEWAY path)", () => {
  it("is a TRPCError instance with code BAD_GATEWAY", async () => {
    const llm = new FakeLlm(textTurn("no json here"));
    let caught: unknown;
    try {
      await draftEstimateLines(llm, "x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("BAD_GATEWAY");
  });
});
