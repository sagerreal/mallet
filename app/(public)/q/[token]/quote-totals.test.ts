/**
 * Unit tests for the public quote page's client cents math (quote-totals.ts).
 *
 * The helper must mirror the domain's derivations in
 * modules/quoting/domain/estimate.ts EXACTLY — same per-step Math.round order
 * (sub → disc → net → tax → total → deposit) — so these tests compare its output
 * against a real domain Estimate built with the same lines. Odd-cent inputs are
 * chosen so every rounding step actually rounds.
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
} from "@/modules/quoting/domain/estimate";
import { computeQuoteTotals, lineAmountCents } from "./quote-totals";

// ---------------------------------------------------------------------------
// Domain builders
// ---------------------------------------------------------------------------

interface LineSpec {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly isOptional: boolean;
}

const makeLine = (spec: LineSpec, position: number): EstimateLine => {
  const r = EstimateLine.create({
    id: asEstimateLineId(spec.id),
    description: spec.description,
    quantity: spec.quantity,
    rate: money(spec.rateCents),
    cost: zeroMoney,
    isOptional: spec.isOptional,
    needsPhoto: false,
    position,
  });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

const makeEstimate = (
  lines: readonly LineSpec[],
  pricing: { discBps: number; taxBps: number; depBps: number },
): Estimate => {
  const now = new Date("2026-07-01T00:00:00Z");
  const props: EstimateProps = {
    id: asEstimateId("00000000-0000-0000-0000-00000000e571"),
    orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    num: "EST-7001",
    leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
    title: "Totals parity",
    status: "sent",
    discBps: pricing.discBps,
    taxBps: pricing.taxBps,
    depBps: pricing.depBps,
    depPaid: zeroMoney,
    validDays: null,
    sentAt: now,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeRequest: null,
    publicToken: "c".repeat(64),
    lines: lines.map(makeLine),
    createdAt: now,
    updatedAt: now,
  };
  const r = Estimate.create(props);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

// Odd-cent fixture: every derivation step (line amount, discount, tax, deposit)
// lands on a fractional cent before rounding.
const FIXED: LineSpec = {
  id: "00000000-0000-0000-0000-000000000001",
  description: "Labor",
  quantity: 3,
  rateCents: 3_333, // 9_999
  isOptional: false,
};
const OPT_A: LineSpec = {
  id: "00000000-0000-0000-0000-000000000002",
  description: "Anode rod",
  quantity: 1.5,
  rateCents: 999, // round(1498.5) = 1499
  isOptional: true,
};
const OPT_B: LineSpec = {
  id: "00000000-0000-0000-0000-000000000003",
  description: "Expansion tank",
  quantity: 1,
  rateCents: 24_995,
  isOptional: true,
};
const PRICING = { discBps: 1_000, taxBps: 825, depBps: 3_300 }; // 10% / 8.25% / 33%

const expectParity = (
  totals: ReturnType<typeof computeQuoteTotals>,
  domain: Estimate,
): void => {
  expect(totals.subtotalCents).toBe(domain.subtotal());
  expect(totals.discountCents).toBe(domain.discountAmount());
  expect(totals.taxCents).toBe(domain.taxAmount());
  expect(totals.totalCents).toBe(domain.total());
  expect(totals.depositCents).toBe(domain.depositDue());
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lineAmountCents", () => {
  it("rounds quantity × rate to whole cents like EstimateLine.amount (half up)", () => {
    expect(lineAmountCents(1.5, 999)).toBe(1_499); // 1498.5 → 1499
    expect(lineAmountCents(3, 3_333)).toBe(9_999);
    expect(lineAmountCents(0.33, 101)).toBe(33); // 33.33 → 33
    const domainLine = makeLine(OPT_A, 0);
    expect(lineAmountCents(OPT_A.quantity, OPT_A.rateCents)).toBe(domainLine.amount());
  });
});

describe("computeQuoteTotals — parity with the domain (odd cents)", () => {
  it("no optional lines selected → matches the sent estimate exactly (render-identical baseline)", () => {
    const domain = makeEstimate([FIXED, OPT_A, OPT_B], PRICING);
    const totals = computeQuoteTotals({
      fixedSubtotalCents: domain.subtotal(),
      selectedOptionalLines: [],
      ...PRICING,
    });
    expectParity(totals, domain);
    // Pin the concrete numbers so a rounding regression is loud.
    expect(totals).toEqual({
      subtotalCents: 9_999,
      discountCents: 1_000, // round(999.9)
      taxCents: 742, // round(8999 × 825 / 10000 = 742.4175)
      totalCents: 9_741,
      depositCents: 3_215, // round(9741 × 3300 / 10000 = 3214.53)
    });
  });

  it("one optional line selected → matches a domain estimate with that line committed", () => {
    const base = makeEstimate([FIXED, OPT_A, OPT_B], PRICING);
    // Domain twin: OPT_A flipped to non-optional (what accept commits), OPT_B dropped.
    const tuned = makeEstimate([FIXED, { ...OPT_A, isOptional: false }], PRICING);
    const totals = computeQuoteTotals({
      fixedSubtotalCents: base.subtotal(),
      selectedOptionalLines: [{ quantity: OPT_A.quantity, rateCents: OPT_A.rateCents }],
      ...PRICING,
    });
    expectParity(totals, tuned);
    expect(totals).toEqual({
      subtotalCents: 11_498, // 9999 + 1499
      discountCents: 1_150, // round(1149.8)
      taxCents: 854, // round(10348 × 825 / 10000 = 853.71)
      totalCents: 11_202,
      depositCents: 3_697, // round(11202 × 3300 / 10000 = 3696.66)
    });
  });

  it("all optional lines selected → matches a domain estimate with every line committed", () => {
    const base = makeEstimate([FIXED, OPT_A, OPT_B], PRICING);
    const tuned = makeEstimate(
      [FIXED, { ...OPT_A, isOptional: false }, { ...OPT_B, isOptional: false }],
      PRICING,
    );
    const totals = computeQuoteTotals({
      fixedSubtotalCents: base.subtotal(),
      selectedOptionalLines: [
        { quantity: OPT_A.quantity, rateCents: OPT_A.rateCents },
        { quantity: OPT_B.quantity, rateCents: OPT_B.rateCents },
      ],
      ...PRICING,
    });
    expectParity(totals, tuned);
  });

  it("zero bps everywhere → totals collapse to the plain subtotal", () => {
    const pricing = { discBps: 0, taxBps: 0, depBps: 0 };
    const domain = makeEstimate([FIXED, { ...OPT_A, isOptional: false }], pricing);
    const totals = computeQuoteTotals({
      fixedSubtotalCents: 9_999,
      selectedOptionalLines: [{ quantity: OPT_A.quantity, rateCents: OPT_A.rateCents }],
      ...pricing,
    });
    expectParity(totals, domain);
    expect(totals.totalCents).toBe(11_498);
    expect(totals.discountCents).toBe(0);
    expect(totals.taxCents).toBe(0);
    expect(totals.depositCents).toBe(0);
  });
});
