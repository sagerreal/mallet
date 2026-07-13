import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { LlmClient, LlmRequest, AssistantTurn } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";
import { draftEstimateTiers } from "./draft-estimate-tiers";
import { EMPTY_ESTIMATE_CONTEXT } from "./estimate-context";

// ---------------------------------------------------------------------------
// Helpers (fake LLM pattern from draft-estimate.test.ts)
// ---------------------------------------------------------------------------

const usage = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0 };

const toolUseTurn = (input: unknown): AssistantTurn => ({
  stopReason: "tool_use",
  blocks: [
    {
      type: "tool_use",
      id: "tu_1",
      name: "submit_tiered_estimate",
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
  recommended: "better",
  good: {
    note: "Repair the failed valve",
    lines: [
      { description: "Labor — replace fill valve", quantity: 1, unitPriceUsd: 170 },
      { description: "Fill valve + supply line", quantity: 1, unitPriceUsd: 45 },
    ],
  },
  better: {
    note: "Repair plus prevent the next leak",
    lines: [
      { description: "Labor — replace fill valve + angle stop", quantity: 2, unitPriceUsd: 170 },
      { description: "Fill valve, angle stop, supply line", quantity: 1, unitPriceUsd: 95 },
    ],
  },
  best: {
    note: "Replace the toilet outright",
    lines: [
      { description: "Toilet — Toto Drake, supplied & installed", quantity: 1, unitPriceUsd: 460 },
      { description: "Haul away & disposal", quantity: 1, unitPriceUsd: 75 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("draftEstimateTiers — refine loop", () => {
  const REFINE = {
    previousLines: [{ description: "Toilet rebuild", quantity: 1, rateCents: 30_000 }],
    feedback: "the rebuild is $250 around here, not $300",
  };

  it("carries the correction into the prompt and returns proposals on refine", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: [{ kind: "rule", rule: "Toilet rebuilds go out at $250" }],
      }),
    );
    const result = await draftEstimateTiers(llm, "rebuild the toilet", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(llm.capturedRequest!.system).toContain("Refine an earlier draft");
    expect(llm.capturedRequest!.system).toContain("the rebuild is $250 around here, not $300");
    expect(result.proposals).toEqual([{ kind: "rule", rule: "Toilet rebuilds go out at $250" }]);
  });

  it("returns [] proposals outside refine even when the model volunteers them", async () => {
    const llm = new FakeLlm(
      toolUseTurn({ ...SAMPLE_TOOL_INPUT, proposals: [{ kind: "rule", rule: "unsolicited" }] }),
    );
    const result = await draftEstimateTiers(llm, "rebuild the toilet");
    expect(result.proposals).toEqual([]);
  });

  // Proposals are an optional side-channel — a malformed one must never cost
  // the office the (valid) regenerated tiers it already paid the model for.
  it("drops malformed proposals but keeps the tiers and the valid proposals", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: [
          { kind: "labor_hours", serviceName: "Toilet rebuild", hours: 1_200 }, // over the 1,000h cap
          { kind: "rule", rule: "Toilet rebuilds go out at $250" },
        ],
      }),
    );
    const result = await draftEstimateTiers(llm, "rebuild the toilet", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(result.recommended).toBe("better");
    expect(result.good.lines).toHaveLength(2);
    expect(result.proposals).toEqual([{ kind: "rule", rule: "Toilet rebuilds go out at $250" }]);
  });
});

describe("draftEstimateTiers — org context", () => {
  it("carries the shop's pricebook, rates, and won quotes into the system prompt", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    await draftEstimateTiers(llm, "replace water heater", {
      catalog: [{ name: "WH install", unitPriceCents: 165000, category: "Water heaters", laborHours: 3 }],
      laborRates: [{ label: "Standard", rateCentsPerHour: 14500, kind: "hourly" }],
      jobInfo: {
        lead: { name: "Dana", source: "Angi", notes: "gate code 4411", address: null },
        messages: [{ direction: "inbound", body: "heater leaking" }],
        visitNotes: [],
      },
      wonQuotes: [
        {
          num: "EST-1042",
          title: "Water heater replacement",
          lines: [{ description: "40-gal heater", quantity: 1, rateCents: 165000 }],
          totalCents: 165000,
        },
      ],
      rules: [{ rule: "Include haul-away on water heater swaps", timesConfirmed: 2 }],
    });

    const system = llm.capturedRequest!.system;
    expect(system).toContain("This shop's pricebook");
    expect(system).toContain("WH install [Water heaters]: $1650.00 — 3h labor");
    expect(system).toContain("This shop's labor rates");
    expect(system).toContain("Customer: heater leaking");
    expect(system).toContain("This shop's rules");
    expect(system).toContain("Include haul-away on water heater swaps");
    expect(system).toContain("Quotes this shop sent and WON");
    expect(system).not.toContain("no pricebook yet");
  });

  it("falls back to the no-pricebook line on an empty context", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    await draftEstimateTiers(llm, "replace water heater");
    expect(llm.capturedRequest!.system).toContain("no pricebook yet");
  });
});

describe("draftEstimateTiers", () => {
  it("returns all three mapped tiers (dollars → cents) plus the recommended key", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    const draft = await draftEstimateTiers(llm, "toilet keeps running, 20-year-old unit");

    expect(draft.recommended).toBe("better");
    expect(draft.good.lines).toHaveLength(2);
    expect(draft.good.lines[0]).toEqual({
      description: "Labor — replace fill valve",
      quantity: 1,
      rateCents: 17000,
    });
    expect(draft.better.lines[1]).toEqual({
      description: "Fill valve, angle stop, supply line",
      quantity: 1,
      rateCents: 9500,
    });
    expect(draft.best.lines[0]).toEqual({
      description: "Toilet — Toto Drake, supplied & installed",
      quantity: 1,
      rateCents: 46000,
    });
    expect(draft.good.note).toBe("Repair the failed valve");
    expect(draft.best.note).toBe("Replace the toilet outright");
  });

  it("maps an omitted tier note to an empty string", async () => {
    const { note: _dropped, ...goodWithoutNote } = SAMPLE_TOOL_INPUT.good;
    const llm = new FakeLlm(toolUseTurn({ ...SAMPLE_TOOL_INPUT, good: goodWithoutNote }));

    const draft = await draftEstimateTiers(llm, "running toilet");

    expect(draft.good.note).toBe("");
    expect(draft.better.note).toBe("Repair plus prevent the next leak");
  });

  it("sends the user description as the first user message", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    const description = "replace kitchen faucet";

    await draftEstimateTiers(llm, description);

    const req = llm.capturedRequest!;
    const firstMsg = req.messages[0];
    expect(firstMsg?.role).toBe("user");
    expect(firstMsg?.kind === "text" && firstMsg.text).toBe(description);
  });

  it("sends exactly one tool (submit_tiered_estimate) with a valid JSON schema, at effort low", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    await draftEstimateTiers(llm, "fix the toilet");

    const req = llm.capturedRequest!;
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0]!.name).toBe("submit_tiered_estimate");
    expect(req.tools[0]!.inputSchema).toMatchObject({ type: "object" });
    expect(req.tools[0]!.inputSchema).not.toHaveProperty("$schema");
    expect(req.effort).toBe("low");
  });

  it("rounds fractional USD prices to whole cents", async () => {
    const tier = (price: number) => ({
      lines: [
        { description: "Labor", quantity: 1, unitPriceUsd: price },
        { description: "Materials", quantity: 1, unitPriceUsd: 10 },
      ],
    });
    const llm = new FakeLlm(
      toolUseTurn({ recommended: "good", good: tier(99.999), better: tier(10), best: tier(10) }),
    );
    const draft = await draftEstimateTiers(llm, "any job");
    expect(draft.good.lines[0]!.rateCents).toBe(10000); // Math.round(99.999 * 100)
  });

  it("falls back to JSON embedded in a text block when no tool_use block is present", async () => {
    const embeddedJson = JSON.stringify(SAMPLE_TOOL_INPUT);
    const llm = new FakeLlm(textTurn(`Here are the options:\n${embeddedJson}\nPlease review.`));

    const draft = await draftEstimateTiers(llm, "toilet keeps running");

    expect(draft.recommended).toBe("better");
    expect(draft.best.lines[1]).toEqual({
      description: "Haul away & disposal",
      quantity: 1,
      rateCents: 7500,
    });
  });

  it("falls back to a valid text block when the tool_use input is malformed", async () => {
    const llm = new FakeLlm({
      stopReason: "tool_use",
      blocks: [
        { type: "tool_use", id: "tu_1", name: "submit_tiered_estimate", input: { wrong: "shape" } },
        { type: "text", text: JSON.stringify(SAMPLE_TOOL_INPUT) },
      ],
      usage,
    });

    const draft = await draftEstimateTiers(llm, "toilet keeps running");

    expect(draft.recommended).toBe("better");
    expect(draft.good.lines).toHaveLength(2);
  });

  it("throws TRPCError BAD_GATEWAY when the model returns no parseable output", async () => {
    const llm = new FakeLlm(textTurn("I am unable to produce an estimate at this time."));

    await expect(draftEstimateTiers(llm, "something vague")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
      message: "AI couldn't draft the three options — try rephrasing",
    });
  });

  it("throws TRPCError BAD_GATEWAY when a tier has fewer than 2 lines (schema cap)", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        good: { lines: [{ description: "Labor", quantity: 1, unitPriceUsd: 100 }] },
      }),
    );
    await expect(draftEstimateTiers(llm, "water heater")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  // ---- output caps: reject what the draft boundary / domain would reject ----

  const withGoodLine = (line: Record<string, unknown>) => ({
    ...SAMPLE_TOOL_INPUT,
    good: {
      lines: [line, { description: "Materials", quantity: 1, unitPriceUsd: 10 }],
    },
  });

  it.each([
    ["quantity with more than 2 decimals", { description: "Labor", quantity: 0.333, unitPriceUsd: 100 }],
    ["quantity above 10,000", { description: "Labor", quantity: 10_001, unitPriceUsd: 100 }],
    ["unit price above $1,000,000", { description: "Labor", quantity: 1, unitPriceUsd: 1_000_001 }],
    ["description longer than 500 chars", { description: "x".repeat(501), quantity: 1, unitPriceUsd: 100 }],
  ])("rejects out-of-bounds model output (%s) → BAD_GATEWAY", async (_name, line) => {
    const llm = new FakeLlm(toolUseTurn(withGoodLine(line)));
    await expect(draftEstimateTiers(llm, "any job")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  it("accepts in-bounds output at the caps (2-decimal quantity, $1,000,000 rate, 500-char description)", async () => {
    const llm = new FakeLlm(
      toolUseTurn(withGoodLine({ description: "y".repeat(500), quantity: 2.25, unitPriceUsd: 1_000_000 })),
    );
    const draft = await draftEstimateTiers(llm, "big job");
    expect(draft.good.lines[0]).toEqual({
      description: "y".repeat(500),
      quantity: 2.25,
      rateCents: 100_000_000,
    });
  });

  it("throws TRPCError PRECONDITION_FAILED when no LLM client is configured", async () => {
    await expect(draftEstimateTiers(null, "any job")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "AI is not configured",
    });
    await expect(draftEstimateTiers(undefined, "any job")).rejects.toBeInstanceOf(TRPCError);
  });

  it("propagates a retryable LlmError as-is (router maps it to TOO_MANY_REQUESTS)", async () => {
    const llm: LlmClient = {
      next: async () => { throw new LlmError(true, "rate limited"); },
    };
    await expect(draftEstimateTiers(llm, "any job")).rejects.toBeInstanceOf(LlmError);
  });

  it("propagates a non-retryable LlmError as-is (router maps it to BAD_GATEWAY)", async () => {
    const llm: LlmClient = {
      next: async () => { throw new LlmError(false, "provider error"); },
    };
    await expect(draftEstimateTiers(llm, "any job")).rejects.toBeInstanceOf(LlmError);
  });
});
