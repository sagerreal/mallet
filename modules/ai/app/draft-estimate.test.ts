import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import type { LlmClient, LlmRequest, AssistantTurn } from "../domain/llm-client";
import { LlmError } from "../domain/llm-client";
import { EMPTY_ESTIMATE_CONTEXT } from "./estimate-context";
import { draftEstimateLines, type CatalogServiceContext } from "./draft-estimate";

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

    const { lines } = await draftEstimateLines(llm, "replace 40-gal water heater, haul away, bring to code");

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
    const { lines } = await draftEstimateLines(llm, "any job");
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

    const { lines } = await draftEstimateLines(llm, "clogged kitchen drain");

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

  // ---- output caps: reject what the draft boundary / domain would reject ----

  const withLine = (line: Record<string, unknown>) => ({
    lines: [line, { description: "Materials", quantity: 1, unitPriceUsd: 10 }],
  });

  it.each([
    ["quantity with more than 2 decimals", { description: "Labor", quantity: 0.333, unitPriceUsd: 100 }],
    ["quantity above 10,000", { description: "Labor", quantity: 10_001, unitPriceUsd: 100 }],
    ["unit price above $1,000,000", { description: "Labor", quantity: 1, unitPriceUsd: 1_000_001 }],
    ["description longer than 500 chars", { description: "x".repeat(501), quantity: 1, unitPriceUsd: 100 }],
  ])("rejects out-of-bounds model output (%s) → BAD_GATEWAY", async (_name, line) => {
    const llm = new FakeLlm(toolUseTurn(withLine(line)));
    await expect(draftEstimateLines(llm, "any job")).rejects.toMatchObject({
      code: "BAD_GATEWAY",
    });
  });

  it("accepts in-bounds output at the caps (2-decimal quantity, $1,000,000 rate, 500-char description)", async () => {
    const llm = new FakeLlm(
      toolUseTurn(withLine({ description: "y".repeat(500), quantity: 2.25, unitPriceUsd: 1_000_000 })),
    );
    const { lines } = await draftEstimateLines(llm, "big job");
    expect(lines[0]).toEqual({
      description: "y".repeat(500),
      quantity: 2.25,
      rateCents: 100_000_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Catalog context (Task 10): when the router passes the org's real pricebook,
// the system prompt must carry it so the model prices from the shop's actual
// book — the LLM call itself stays mocked (no real model call in this file).
// ---------------------------------------------------------------------------

describe("draftEstimateLines — catalog context", () => {
  const SAMPLE_CATALOG: CatalogServiceContext[] = [
    { name: "40-gal gas water heater install", unitPriceCents: 165000, category: "Water heaters", laborHours: 3 },
    { name: "Drain snake — standard", unitPriceCents: 22500, category: "Drains", laborHours: null },
    { name: "Diagnostic / trip fee", unitPriceCents: 8900, category: null, laborHours: null },
  ];
  const catalogContext = (catalog: CatalogServiceContext[]) => ({
    ...EMPTY_ESTIMATE_CONTEXT,
    catalog,
  });

  it("includes each catalog service's name, price, and category in the system prompt", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    await draftEstimateLines(llm, "replace water heater", catalogContext(SAMPLE_CATALOG));

    const system = llm.capturedRequest!.system;
    expect(system).toContain("40-gal gas water heater install");
    expect(system).toContain("$1650.00");
    expect(system).toContain("[Water heaters]");
    expect(system).toContain("Drain snake — standard");
    expect(system).toContain("$225.00");
    expect(system).toContain("Diagnostic / trip fee");
    expect(system).toContain("$89.00");
  });

  it("instructs the model to prefer catalog prices and flag off-book lines", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    await draftEstimateLines(llm, "replace water heater", catalogContext(SAMPLE_CATALOG));

    const system = llm.capturedRequest!.system;
    expect(system).toContain("Prefer these exact prices");
    expect(system).toContain("Off-book:");
  });

  it("omits the pricebook section and off-book instruction when the catalog is empty", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));

    await draftEstimateLines(llm, "replace water heater");

    const system = llm.capturedRequest!.system;
    expect(system).not.toContain("This shop's pricebook");
    expect(system).not.toContain("Off-book:");
  });

  it("does not change tools, messages, or effort when a catalog is supplied", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    const description = "replace water heater";

    await draftEstimateLines(llm, description, catalogContext(SAMPLE_CATALOG));

    const req = llm.capturedRequest!;
    expect(req.tools).toHaveLength(1);
    expect(req.tools[0]!.name).toBe("submit_estimate");
    expect(req.messages).toEqual([{ role: "user", kind: "text", text: description }]);
    expect(req.effort).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// Refine loop: the office corrects an earlier draft. The prompt must carry the
// prior lines + the correction; durable-fact proposals come back ONLY on
// refine runs (volunteered proposals outside refine are dropped).
// ---------------------------------------------------------------------------

describe("draftEstimateLines — refine loop", () => {
  const REFINE = {
    previousLines: [
      { description: "Labor — replace 40-gal water heater", quantity: 10, rateCents: 17_000 },
    ],
    feedback: "that's 5h of labor, not 10",
  };

  it("carries the previous draft and the correction into the system prompt", async () => {
    const llm = new FakeLlm(toolUseTurn(SAMPLE_TOOL_INPUT));
    await draftEstimateLines(llm, "replace water heater", EMPTY_ESTIMATE_CONTEXT, REFINE);

    const system = llm.capturedRequest!.system;
    expect(system).toContain("Refine an earlier draft");
    expect(system).toContain("Labor — replace 40-gal water heater ×10 @ $170.00");
    expect(system).toContain('Correction from the office: "that\'s 5h of labor, not 10"');
    expect(system).toContain("proposals");
  });

  it("returns the model's proposals on a refine run", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: [
          { kind: "labor_hours", serviceName: "40-gal gas water heater install", hours: 5 },
          { kind: "rule", rule: "Water heater swaps take 5h of labor" },
        ],
      }),
    );
    const result = await draftEstimateLines(llm, "replace water heater", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(result.proposals).toEqual([
      { kind: "labor_hours", serviceName: "40-gal gas water heater install", hours: 5 },
      { kind: "rule", rule: "Water heater swaps take 5h of labor" },
    ]);
  });

  it("drops volunteered proposals outside a refine run (never prompted for them)", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: [{ kind: "rule", rule: "unsolicited" }],
      }),
    );
    const result = await draftEstimateLines(llm, "replace water heater");
    expect(result.proposals).toEqual([]);
    expect(llm.capturedRequest!.system).not.toContain("Refine an earlier draft");
  });

  // Proposals are an optional side-channel — a malformed one must never cost
  // the office the (valid) regenerated lines it already paid the model for.
  it("drops malformed proposals but keeps the lines and the valid proposals", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: [
          { kind: "labor_hours", hours: -3 }, // missing serviceName, negative hours
          { kind: "rule", rule: "x".repeat(350) }, // over the 300-char cap
          { kind: "rule", rule: "Water heater swaps take 5h of labor" },
        ],
      }),
    );
    const result = await draftEstimateLines(llm, "replace water heater", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(result.lines).toHaveLength(3);
    expect(result.proposals).toEqual([{ kind: "rule", rule: "Water heater swaps take 5h of labor" }]);
  });

  it("drops a non-array proposals payload without failing the run", async () => {
    const llm = new FakeLlm(toolUseTurn({ ...SAMPLE_TOOL_INPUT, proposals: "not an array" }));
    const result = await draftEstimateLines(llm, "replace water heater", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(result.lines).toHaveLength(3);
    expect(result.proposals).toEqual([]);
  });

  it("caps proposals at 5 valid entries even when the model returns more", async () => {
    const llm = new FakeLlm(
      toolUseTurn({
        ...SAMPLE_TOOL_INPUT,
        proposals: Array.from({ length: 8 }, (_, i) => ({ kind: "rule", rule: `Rule ${i}` })),
      }),
    );
    const result = await draftEstimateLines(llm, "replace water heater", EMPTY_ESTIMATE_CONTEXT, REFINE);
    expect(result.proposals).toHaveLength(5);
    expect(result.proposals[0]).toEqual({ kind: "rule", rule: "Rule 0" });
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
