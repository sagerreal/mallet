/**
 * Unit tests for tier-view.ts — the server-side Good/Better/Best picker
 * structure the public page hands to the QuoteLines island.
 *
 * Guards: null for single/resolved quotes (the picker keys off tiers !== null),
 * fixed/optional split per tier, display-name fallback, redaction (no cost
 * field), and per-tier totals coming from the domain's rounding chain.
 */

import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asEstimateLineId,
  money,
  zeroMoney,
} from "@mallet/shared/types";
import {
  Estimate,
  EstimateLine,
  type EstimateProps,
  type QuoteTier,
  type TierNames,
} from "@/modules/quoting/domain/estimate";
import { tierViewsFor } from "./tier-view";

interface LineSpec {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly isOptional?: boolean;
  readonly tier?: QuoteTier;
}

const makeLine = (spec: LineSpec, position: number): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(spec.id),
    description: spec.description,
    quantity: spec.quantity,
    rate: money(spec.rateCents),
    cost: zeroMoney,
    isOptional: spec.isOptional ?? false,
    needsPhoto: false,
    position,
    tier: spec.tier ?? null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const makeEstimate = (
  lines: readonly LineSpec[],
  overrides: Partial<EstimateProps> = {},
): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: asEstimateId("00000000-0000-0000-0000-00000000e572"),
    orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    num: "EST-7002",
    leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
    title: "Tier views",
    status: "sent",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: null,
    sentAt: now,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeRequest: null,
    publicToken: "d".repeat(64),
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines: lines.map(makeLine),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const GBB_LINES: readonly LineSpec[] = [
  { id: "00000000-0000-0000-0000-000000000001", description: "Patch leak", quantity: 1, rateCents: 20_000, tier: "good" },
  { id: "00000000-0000-0000-0000-000000000002", description: "Repair section", quantity: 2, rateCents: 17_500, tier: "better" },
  { id: "00000000-0000-0000-0000-000000000003", description: "Camera inspection", quantity: 1, rateCents: 5_000, isOptional: true, tier: "better" },
  { id: "00000000-0000-0000-0000-000000000004", description: "Replace run", quantity: 1, rateCents: 90_000, tier: "best" },
];

describe("tierViewsFor", () => {
  it("returns null for a single-format quote (tiers === null keys the picker off)", () => {
    const single = makeEstimate([
      { id: "00000000-0000-0000-0000-000000000009", description: "Work", quantity: 1, rateCents: 30_000 },
    ]);
    expect(tierViewsFor(single)).toBeNull();
  });

  it("returns null once the quote is resolved (acceptedTier stamped)", () => {
    // Post-accept the committed lines are RESOLVED — tier tags cleared (domain
    // invariant), status accepted — and the page renders them single-format.
    const resolved = makeEstimate(
      [{ id: "00000000-0000-0000-0000-000000000002", description: "Repair section", quantity: 2, rateCents: 17_500 }],
      {
        status: "accepted",
        acceptedAt: new Date("2026-07-02T00:00:00Z"),
        recommendedTier: "better",
        acceptedTier: "better",
      },
    );
    expect(tierViewsFor(resolved)).toBeNull();
  });

  it("splits fixed vs optional lines per tier and carries the recommended tier", () => {
    const views = tierViewsFor(makeEstimate(GBB_LINES, { recommendedTier: "better" }));
    expect(views).not.toBeNull();
    expect(views!.recommendedTier).toBe("better");
    expect(views!.tiers.map((t) => t.tier)).toEqual(["good", "better", "best"]);

    const better = views!.tiers[1]!;
    expect(better.fixedLines.map((l) => l.description)).toEqual(["Repair section"]);
    expect(better.optionalLines.map((l) => l.description)).toEqual(["Camera inspection"]);
    // Redaction: the view carries exactly id/description/quantity/rateCents — no cost.
    expect(Object.keys(better.fixedLines[0]!).sort()).toEqual([
      "description",
      "id",
      "quantity",
      "rateCents",
    ]);
  });

  it("uses the estimate's display names, falling back to Good/Better/Best", () => {
    const named: TierNames = { good: "Patch", better: "Repair", best: "Replace" };
    const withNames = tierViewsFor(
      makeEstimate(GBB_LINES, { recommendedTier: "better", tierNames: named }),
    );
    expect(withNames!.tiers.map((t) => t.name)).toEqual(["Patch", "Repair", "Replace"]);

    const unnamed = tierViewsFor(makeEstimate(GBB_LINES, { recommendedTier: "better" }));
    expect(unnamed!.tiers.map((t) => t.name)).toEqual(["Good", "Better", "Best"]);
  });

  it("per-tier totals come from the domain chain (fixed lines only, tax applied)", () => {
    const estimate = makeEstimate(GBB_LINES, { recommendedTier: "better", taxBps: 1_000 });
    const views = tierViewsFor(estimate)!;
    // better: 2 × 17_500 = 35_000 fixed (optional excluded) + 10% tax.
    expect(views.tiers[1]!.totalCents).toBe(38_500);
    expect(views.tiers[1]!.totalCents).toBe(estimate.totalsForTier("better").total);
    expect(views.tiers[0]!.totalCents).toBe(estimate.totalsForTier("good").total);
    expect(views.tiers[2]!.totalCents).toBe(estimate.totalsForTier("best").total);
  });

  // ---- empty tiers are not options: never show what accept would refuse ----

  it("omits a tier with no lines at all — no selectable $0.00 card", () => {
    const twoTiers = GBB_LINES.filter((l) => l.tier !== "best");
    const views = tierViewsFor(makeEstimate(twoTiers, { recommendedTier: "better" }))!;
    expect(views.tiers.map((t) => t.tier)).toEqual(["good", "better"]);
  });

  it("omits a tier with only OPTIONAL lines (accept refuses it: no fixed line)", () => {
    const lines: readonly LineSpec[] = [
      ...GBB_LINES.filter((l) => l.tier !== "best"),
      { id: "00000000-0000-0000-0000-000000000005", description: "Optional extra", quantity: 1, rateCents: 10_000, isOptional: true, tier: "best" },
    ];
    const views = tierViewsFor(makeEstimate(lines, { recommendedTier: "better" }))!;
    expect(views.tiers.map((t) => t.tier)).toEqual(["good", "better"]);
  });

  it("keeps a single surviving tier (the island renders it without a picker)", () => {
    const goodOnly = GBB_LINES.filter((l) => l.tier === "good");
    const views = tierViewsFor(makeEstimate(goodOnly, { recommendedTier: "good" }))!;
    expect(views.tiers.map((t) => t.tier)).toEqual(["good"]);
    expect(views.recommendedTier).toBe("good");
  });

  it("re-points the recommended tier to a real one when the recommended tier is empty (draft preview)", () => {
    // Sent quotes can't hit this (send gates on the recommended tier's subtotal),
    // but a previewed draft can — the page must not default to a refusable option.
    const goodOnly = GBB_LINES.filter((l) => l.tier === "good");
    const views = tierViewsFor(makeEstimate(goodOnly, { recommendedTier: "better" }))!;
    expect(views.recommendedTier).toBe("good");
  });

  it("returns null when NO tier has a fixed line — the page falls back to the single layout", () => {
    const optionalOnly: readonly LineSpec[] = [
      { id: "00000000-0000-0000-0000-000000000006", description: "Optional only", quantity: 1, rateCents: 5_000, isOptional: true, tier: "good" },
    ];
    expect(tierViewsFor(makeEstimate(optionalOnly, { recommendedTier: "good" }))).toBeNull();
  });
});
