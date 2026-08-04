/**
 * Unit tests for buildAcceptLinesFromSelection — the accept-time selection builder
 * behind the public quote route.
 *
 * SECURITY property under test: the function accepts only an ID SUBSET and builds
 * every committed line FROM THE STORED ESTIMATE (description/quantity/rate/cost/
 * needsPhoto preserved). Unknown ids and non-optional ids are rejected outright.
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
import { Estimate, EstimateLine, type EstimateProps, type QuoteTier } from "../domain/estimate";
import { buildAcceptLinesFromSelection, buildAcceptLinesForTier } from "./select-optional-lines";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const FIXED_ID = "00000000-0000-0000-0000-00000000000f";
const OPT_A_ID = "00000000-0000-0000-0000-0000000000a1";
const OPT_B_ID = "00000000-0000-0000-0000-0000000000b2";
const UNKNOWN_ID = "99999999-9999-9999-9999-999999999999";

const makeLine = (
  id: string,
  description: string,
  quantity: number,
  rateCents: number,
  costCents: number,
  isOptional: boolean,
  needsPhoto: boolean,
  position: number,
): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(id),
    description,
    quantity,
    rate: money(rateCents),
    cost: money(costCents),
    isOptional,
    needsPhoto,
    position,
    tier: null,
    materialId: null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const makeSentEstimate = (lines: readonly EstimateLine[]): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: asEstimateId("00000000-0000-0000-0000-00000000e572"),
    orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    num: "EST-7002",
    leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
    title: "Selection test",
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
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: "d".repeat(64),
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines,
    createdAt: now,
    updatedAt: now,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const fixture = (): Estimate =>
  makeSentEstimate([
    makeLine(FIXED_ID, "Labor", 3, 3_333, 1_200, false, true, 0),
    makeLine(OPT_A_ID, "Anode rod", 1.5, 999, 450, true, false, 1),
    makeLine(OPT_B_ID, "Expansion tank", 1, 24_995, 9_000, true, false, 2),
  ]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAcceptLinesFromSelection", () => {
  it("omitted selection → none (caller must omit cmd.lines)", () => {
    expect(buildAcceptLinesFromSelection(fixture(), undefined)).toEqual({ kind: "none" });
  });

  it("empty selection → none", () => {
    expect(buildAcceptLinesFromSelection(fixture(), [])).toEqual({ kind: "none" });
  });

  it("valid subset → fixed lines + selected optional flipped to isOptional:false, from STORED data", () => {
    const result = buildAcceptLinesFromSelection(fixture(), [OPT_A_ID]);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines).toEqual([
      // Fixed line preserved verbatim (incl. cost + needsPhoto).
      { description: "Labor", quantity: 3, rateCents: 3_333, costCents: 1_200, isOptional: false, needsPhoto: true },
      // Selected optional line flipped to non-optional, stored content preserved.
      { description: "Anode rod", quantity: 1.5, rateCents: 999, costCents: 450, isOptional: false, needsPhoto: false },
      // OPT_B was not selected → dropped from the committed set.
    ]);
  });

  it("selecting every optional line commits them all", () => {
    const result = buildAcceptLinesFromSelection(fixture(), [OPT_A_ID, OPT_B_ID]);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines).toHaveLength(3);
    expect(result.lines.every((l) => !l.isOptional)).toBe(true);
  });

  it("duplicate ids are deduped, not double-committed", () => {
    const result = buildAcceptLinesFromSelection(fixture(), [OPT_A_ID, OPT_A_ID]);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines.filter((l) => l.description === "Anode rod")).toHaveLength(1);
  });

  it("unknown id → invalid (nothing committed)", () => {
    expect(buildAcceptLinesFromSelection(fixture(), [UNKNOWN_ID])).toEqual({ kind: "invalid" });
  });

  it("a NON-optional line id → invalid (fixed lines are not toggleable)", () => {
    expect(buildAcceptLinesFromSelection(fixture(), [FIXED_ID])).toEqual({ kind: "invalid" });
  });

  it("a valid id mixed with an unknown id → invalid (all-or-nothing)", () => {
    expect(buildAcceptLinesFromSelection(fixture(), [OPT_A_ID, UNKNOWN_ID])).toEqual({
      kind: "invalid",
    });
  });
});

// ---------------------------------------------------------------------------
// buildAcceptLinesForTier — the Good/Better/Best variant. Same security model:
// ID subset only, committed lines built from STORED data, scoped to the CHOSEN tier.
// ---------------------------------------------------------------------------

const GOOD_FIXED_ID = "00000000-0000-0000-0000-00000000001f";
const BETTER_FIXED_ID = "00000000-0000-0000-0000-00000000002f";
const BETTER_OPT_ID = "00000000-0000-0000-0000-0000000000c1";
const BEST_FIXED_ID = "00000000-0000-0000-0000-00000000003f";
const GOOD_OPT_ID = "00000000-0000-0000-0000-0000000000d1";

const makeTierLine = (
  id: string,
  description: string,
  rateCents: number,
  isOptional: boolean,
  tier: QuoteTier,
  position: number,
): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(id),
    description,
    quantity: 1,
    rate: money(rateCents),
    cost: money(100),
    isOptional,
    needsPhoto: false,
    position,
    tier,
    materialId: null,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const gbbFixture = (): Estimate => {
  const props: EstimateProps = {
    ...makeSentEstimate([makeLine(FIXED_ID, "x", 1, 1_000, 0, false, false, 0)]).props,
    recommendedTier: "better",
    lines: [
      makeTierLine(GOOD_FIXED_ID, "Patch leak", 20_000, false, "good", 0),
      makeTierLine(GOOD_OPT_ID, "Good add-on", 2_000, true, "good", 1),
      makeTierLine(BETTER_FIXED_ID, "Repair section", 35_000, false, "better", 2),
      makeTierLine(BETTER_OPT_ID, "Camera inspection", 5_000, true, "better", 3),
      makeTierLine(BEST_FIXED_ID, "Replace run", 90_000, false, "best", 4),
    ],
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe("buildAcceptLinesForTier", () => {
  it("no selection → the chosen tier's fixed lines only, from STORED data", () => {
    const result = buildAcceptLinesForTier(gbbFixture(), "better", undefined);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines).toEqual([
      { description: "Repair section", quantity: 1, rateCents: 35_000, costCents: 100, isOptional: false, needsPhoto: false },
    ]);
  });

  it("selecting the chosen tier's optional flips it non-optional and commits it", () => {
    const result = buildAcceptLinesForTier(gbbFixture(), "better", [BETTER_OPT_ID]);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines).toHaveLength(2);
    expect(result.lines.every((l) => !l.isOptional)).toBe(true);
    expect(result.lines.map((l) => l.description)).toEqual(["Repair section", "Camera inspection"]);
  });

  it("an optional id from ANOTHER tier → invalid (selection is scoped to the chosen tier)", () => {
    expect(buildAcceptLinesForTier(gbbFixture(), "better", [GOOD_OPT_ID])).toEqual({
      kind: "invalid",
    });
  });

  it("a fixed line id of the chosen tier → invalid (fixed lines are not toggleable)", () => {
    expect(buildAcceptLinesForTier(gbbFixture(), "better", [BETTER_FIXED_ID])).toEqual({
      kind: "invalid",
    });
  });

  it("an unknown id → invalid", () => {
    expect(buildAcceptLinesForTier(gbbFixture(), "better", [UNKNOWN_ID])).toEqual({
      kind: "invalid",
    });
  });

  it("a tier with no optionals accepts an empty selection and commits its fixed lines", () => {
    const result = buildAcceptLinesForTier(gbbFixture(), "best", []);
    expect(result.kind).toBe("lines");
    if (result.kind !== "lines") throw new Error("expected lines");
    expect(result.lines).toEqual([
      { description: "Replace run", quantity: 1, rateCents: 90_000, costCents: 100, isOptional: false, needsPhoto: false },
    ]);
  });
});
