import { describe, it, expect } from "vitest";
import {
  diffAiDraft,
  MAX_DELTAS_PER_SEND,
  type AiDraftLine,
  type SentLineView,
} from "./edit-delta";

const ai = (over: Partial<AiDraftLine> = {}): AiDraftLine => ({
  description: "Water heater swap — labor",
  quantity: 5,
  rateCents: 15_000,
  ...over,
});

const sent = (over: Partial<SentLineView> = {}): SentLineView => ({
  description: "Water heater swap — labor",
  quantity: 5,
  rateCents: 15_000,
  isOptional: false,
  tier: null,
  ...over,
});

describe("diffAiDraft — matched-line deltas", () => {
  it("identical lines produce no deltas", () => {
    expect(diffAiDraft([ai()], [sent()])).toEqual([]);
  });

  it("a ≤10% price move is immaterial", () => {
    expect(diffAiDraft([ai({ rateCents: 10_000 })], [sent({ rateCents: 11_000 })])).toEqual([]);
    expect(diffAiDraft([ai({ rateCents: 10_000 })], [sent({ rateCents: 9_000 })])).toEqual([]);
  });

  it("a >10% price move yields a directional price delta", () => {
    const down = diffAiDraft([ai({ rateCents: 20_000 })], [sent({ rateCents: 15_000 })]);
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ kind: "price", direction: "down", rulePrefix: "Price down:" });
    expect(down[0]!.rule).toContain("$150.00");
    expect(down[0]!.rule).toContain("$200.00");

    const up = diffAiDraft([ai({ rateCents: 10_000 })], [sent({ rateCents: 20_000 })]);
    expect(up[0]).toMatchObject({ kind: "price", direction: "up" });
  });

  it("a >10% quantity move yields a directional quantity delta", () => {
    const deltas = diffAiDraft([ai({ quantity: 10 })], [sent({ quantity: 5 })]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "quantity", direction: "down", rulePrefix: "Quantity down:" });
    expect(deltas[0]!.rule).toContain("usually takes 5, not 10");
  });

  it("price AND quantity changes on one line yield two deltas", () => {
    const deltas = diffAiDraft(
      [ai({ quantity: 10, rateCents: 20_000 })],
      [sent({ quantity: 5, rateCents: 10_000 })],
    );
    expect(deltas.map((d) => d.kind).sort()).toEqual(["price", "quantity"]);
  });

  it("a zero-rate AI line that gains a price is material", () => {
    const deltas = diffAiDraft([ai({ rateCents: 0 })], [sent({ rateCents: 5_000 })]);
    expect(deltas[0]).toMatchObject({ kind: "price", direction: "up" });
  });
});

describe("diffAiDraft — description matching", () => {
  it("pairs fuzzy descriptions by token overlap (no false added/removed)", () => {
    const deltas = diffAiDraft(
      [ai({ description: "Labor — install water heater", rateCents: 20_000 })],
      [sent({ description: "Water heater install labor", rateCents: 10_000 })],
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.kind).toBe("price");
  });

  it("prefers the exact-text match when several lines share words", () => {
    const deltas = diffAiDraft(
      [
        ai({ description: "Haul away old heater", rateCents: 5_000 }),
        ai({ description: "Heater permit", rateCents: 8_000 }),
      ],
      [
        sent({ description: "Heater permit", rateCents: 8_000 }),
        sent({ description: "Haul away old heater", rateCents: 5_000 }),
      ],
    );
    expect(deltas).toEqual([]);
  });

  it("unmatched non-optional sent lines are 'added'; unmatched AI lines are 'removed'", () => {
    const deltas = diffAiDraft(
      [ai({ description: "Expansion tank" })],
      [sent({ description: "Sediment flush", rateCents: 12_000 })],
    );
    expect(deltas.map((d) => d.kind).sort()).toEqual(["added", "removed"]);
    const added = deltas.find((d) => d.kind === "added")!;
    expect(added.rulePrefix).toBe("Adds:");
    expect(added.rule).toContain("Sediment flush");
    const removed = deltas.find((d) => d.kind === "removed")!;
    expect(removed.rulePrefix).toBe("Drops:");
    expect(removed.rule).toContain("Expansion tank");
  });

  it("does NOT pair unrelated lines sharing one generic token (honest Adds+Drops, no false price rule)", () => {
    // "Water shutoff valve" ($120) deleted; "Water filtration system" ($2,000) added.
    // One shared token ("water") that dominates neither description — pairing them
    // would mint a confidently wrong "Price up: ... $2000.00, not $120.00" rule.
    const deltas = diffAiDraft(
      [ai({ description: "Water shutoff valve", rateCents: 12_000 })],
      [sent({ description: "Water filtration system", rateCents: 200_000 })],
    );
    expect(deltas.map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });

  it("pairs on a single shared token when it makes up ≥50% of BOTH descriptions", () => {
    const deltas = diffAiDraft(
      [ai({ description: "Labor", rateCents: 10_000 })],
      [sent({ description: "Labor charge", rateCents: 20_000 })],
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "price", direction: "up" });
  });

  it("added OPTIONAL lines are ignored (upsell add-ons are not corrections)", () => {
    const deltas = diffAiDraft(
      [ai()],
      [sent(), sent({ description: "Optional descaler", isOptional: true, rateCents: 9_000 })],
    );
    expect(deltas).toEqual([]);
  });
});

describe("diffAiDraft — tiers and caps", () => {
  it("compares within a tier only (Good never pairs with Best)", () => {
    const deltas = diffAiDraft(
      [
        ai({ description: "Repair valve", tier: "good", rateCents: 10_000 }),
        ai({ description: "Repair valve", tier: "best", rateCents: 30_000 }),
      ],
      [
        sent({ description: "Repair valve", tier: "good", rateCents: 10_000 }),
        sent({ description: "Repair valve", tier: "best", rateCents: 40_000 }),
      ],
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "price", direction: "up" });
  });

  it(`caps at ${MAX_DELTAS_PER_SEND} deltas per send`, () => {
    const aiLines = Array.from({ length: 15 }, (_, i) =>
      ai({ description: `Distinct widget alpha${i}`, rateCents: 10_000 }),
    );
    const sentLines = aiLines.map((l) => sent({ description: l.description, rateCents: 20_000 }));
    expect(diffAiDraft(aiLines, sentLines)).toHaveLength(MAX_DELTAS_PER_SEND);
  });

  it("drops deltas whose descriptions have no usable keywords", () => {
    const deltas = diffAiDraft([ai({ description: "-- ??" })], []);
    expect(deltas).toEqual([]);
  });

  it("keeps rule sentences within the 300-char domain cap", () => {
    const long = "x".repeat(400);
    const deltas = diffAiDraft([ai({ description: long, rateCents: 10_000 })], [sent({ description: long, rateCents: 20_000 })]);
    expect(deltas[0]!.rule.length).toBeLessThanOrEqual(300);
  });
});
