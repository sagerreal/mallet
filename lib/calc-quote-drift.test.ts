/**
 * lib/calc-quote-drift.test.ts
 *
 * calcQuote (lib/prototype-sample.ts) against the canonical chain
 * (modules/quoting/domain/estimate.ts). Two things are asserted here, and they pull in opposite
 * directions on purpose:
 *
 *  1. TAXABILITY AGREES. The two implementations apply `taxable` the same way — a non-taxable
 *     line stays in the subtotal and out of the tax base, and the discount comes off that base
 *     at the same rate. Adding taxability introduced no new disagreement.
 *
 *  2. ROUNDING DOES NOT, AND ALREADY DID NOT. calcQuote is float dollars with no rounding
 *     anywhere; the domain is integer cents rounded per line and at every derivation step. On
 *     odd-cent quotes the two land up to a cent apart, and the office screens that render from
 *     calcQuote therefore show a figure the customer's own document does not. That gap predates
 *     per-line tax — it is pinned here so it cannot widen unnoticed, and so closing it is a
 *     deliberate decision with a failing test to point at rather than a silent discovery.
 *
 * The office surfaces reading calcQuote: estimate-modal.tsx, cust-quote-modal.tsx and
 * lib/estimates.ts (estTotal).
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
import { Estimate, EstimateLine, type EstimateProps } from "@/modules/quoting/domain/estimate";
import { calcQuote, type SampleEstimateLine } from "@/lib/prototype-sample";

interface Spec {
  readonly quantity: number;
  readonly rateCents: number;
  readonly optional?: boolean;
  readonly taxable?: boolean;
}

/** Percentages as the store holds them; bps as the domain holds them. */
interface Pricing {
  readonly discPct: number;
  readonly taxPct: number;
  readonly depPct: number;
}

const domainOf = (specs: readonly Spec[], pricing: Pricing): Estimate => {
  const now = new Date("2026-08-01T00:00:00Z");
  const lines = specs.map((spec, i) => {
    const r = EstimateLine.create({
      id: asEstimateLineId(`00000000-0000-0000-0000-00000000000${i}`),
      description: `Line ${i}`,
      quantity: spec.quantity,
      rate: money(spec.rateCents),
      cost: zeroMoney,
      isOptional: spec.optional ?? false,
      needsPhoto: false,
      taxable: spec.taxable ?? true,
      position: i,
      tier: null,
      materialId: null,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  });
  const props: EstimateProps = {
    id: asEstimateId("00000000-0000-0000-0000-0000000000d1"),
    orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    num: "EST-9001",
    leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
    title: "Drift",
    status: "sent",
    discBps: Math.round(pricing.discPct * 100),
    taxBps: Math.round(pricing.taxPct * 100),
    depBps: Math.round(pricing.depPct * 100),
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

const storeLinesOf = (specs: readonly Spec[]): SampleEstimateLine[] =>
  specs.map((spec, i) => ({
    d: `Line ${i}`,
    q: spec.quantity,
    r: spec.rateCents / 100,
    ...(spec.optional ? { opt: true } : {}),
    ...(spec.taxable === false ? { notax: true } : {}),
  }));

/** What a dollar figure from calcQuote actually renders as (`fmt$` rounds to 2dp). */
const displayed = (dollars: number): number => Math.round(dollars * 100) / 100;

const centsAsDollars = (cents: number): number => cents / 100;

describe("calcQuote applies taxability exactly as the domain does", () => {
  // 20% off 8.25% tax on whole-dollar rates: every step lands on a whole cent, so the rounding
  // gap below cannot contaminate the answer and any difference here is the tax RULE itself.
  const pricing: Pricing = { discPct: 20, taxPct: 8.25, depPct: 0 };
  const specs: readonly Spec[] = [
    { quantity: 1, rateCents: 100_00, taxable: true },
    { quantity: 1, rateCents: 40_00, taxable: false },
  ];

  it("keeps a non-taxable line in the subtotal and out of the tax", () => {
    const domain = domainOf(specs, pricing);
    const float = calcQuote(storeLinesOf(specs), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });
    // The non-taxable line is billed in full and taxed at nothing.
    expect(domain.subtotal()).toBe(140_00);
    expect(domain.taxableBase()).toBe(100_00);
    expect(domain.taxAmount()).toBe(6_60); // 8.25% of the discounted $80, not of $112
    expect(displayed(float.sub)).toBe(centsAsDollars(domain.subtotal()));
    expect(displayed(float.disc)).toBe(centsAsDollars(domain.discountAmount()));
    expect(displayed(float.taxed)).toBe(centsAsDollars(domain.taxAmount()));
    expect(displayed(float.total)).toBe(centsAsDollars(domain.total()));
  });

  it("charges no tax when nothing is taxable, and still bills the work", () => {
    const untaxed: readonly Spec[] = [{ quantity: 2, rateCents: 75_00, taxable: false }];
    const domain = domainOf(untaxed, pricing);
    const float = calcQuote(storeLinesOf(untaxed), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });
    expect(float.taxed).toBe(0);
    expect(domain.taxAmount()).toBe(0);
    expect(displayed(float.total)).toBe(centsAsDollars(domain.total()));
  });

  it("still taxes an ordinary all-taxable quote exactly as before", () => {
    const all: readonly Spec[] = [{ quantity: 1, rateCents: 100_00 }];
    const domain = domainOf(all, pricing);
    const float = calcQuote(storeLinesOf(all), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });
    expect(domain.taxAmount()).toBe(6_60);
    expect(displayed(float.taxed)).toBe(6.6);
  });
});

describe("calcQuote's float-dollar rounding gap against the canonical chain (PRE-EXISTING)", () => {
  it("is a cent under the domain on the live 10% / 8.25% discount case", () => {
    // The exact quote behind commit 1cbc070: $114.98 of lines, 10% off, 8.25% tax.
    const specs: readonly Spec[] = [
      { quantity: 3, rateCents: 33_33 },
      { quantity: 1.5, rateCents: 9_99 },
    ];
    const pricing: Pricing = { discPct: 10, taxPct: 8.25, depPct: 0 };
    const domain = domainOf(specs, pricing);
    const float = calcQuote(storeLinesOf(specs), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });

    // The domain, the invoice and the customer's own page all state $112.02.
    expect(domain.total()).toBe(112_02);
    // The office screens render $112.01.
    expect(displayed(float.total)).toBe(112.01);
    expect(displayed(float.total)).not.toBe(centsAsDollars(domain.total()));
  });

  it("is a cent under on the subtotal too, when per-line rounding is what differs", () => {
    // 1.5 × $9.99 = $14.985 and 2.5 × $3.33 = $8.325. The domain rounds each line first
    // ($14.99 + $8.33 = $23.32); calcQuote sums the raw products ($23.31).
    const specs: readonly Spec[] = [
      { quantity: 1.5, rateCents: 9_99 },
      { quantity: 2.5, rateCents: 3_33 },
    ];
    const pricing: Pricing = { discPct: 10, taxPct: 8.25, depPct: 33 };
    const domain = domainOf(specs, pricing);
    const float = calcQuote(storeLinesOf(specs), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });

    expect(domain.subtotal()).toBe(23_32);
    expect(displayed(float.sub)).toBe(23.31);
    expect(domain.total()).toBe(22_72);
    expect(displayed(float.total)).toBe(22.71);
    expect(domain.depositDue()).toBe(7_50);
    expect(displayed(float.dep)).toBe(7.49);
  });

  it("agrees exactly whenever every step lands on a whole cent", () => {
    const specs: readonly Spec[] = [{ quantity: 1, rateCents: 100_00 }];
    const pricing: Pricing = { discPct: 0, taxPct: 8.25, depPct: 0 };
    const domain = domainOf(specs, pricing);
    const float = calcQuote(storeLinesOf(specs), {
      disc: pricing.discPct,
      tax: pricing.taxPct,
      dep: pricing.depPct,
    });
    expect(displayed(float.total)).toBe(centsAsDollars(domain.total()));
    expect(displayed(float.taxed)).toBe(centsAsDollars(domain.taxAmount()));
  });
});
