import { describe, it, expect } from "vitest";
import {
  asEstimateId,
  asEstimateLineId,
  asOrgId,
  asLeadId,
  money,
  zeroMoney,
  isOk,
  type PricingRates,
} from "@mallet/shared/types";
import { Estimate, EstimateLine } from "./estimate";
import type { SignatureDraft } from "./signature";

/**
 * A technician pricing at a customer's door, WITH discount / tax / deposit.
 *
 * The invariant every test here defends: what the customer signs is what they owe. The
 * authorisation sentence, the frozen snapshot and the estimate's own total are three views of one
 * number, and none of them may disagree with the other two.
 */

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const NOW = new Date("2026-08-01T12:00:00Z");

let lineSeq = 0;
const line = (rateCents: number, quantity = 1): EstimateLine => {
  lineSeq += 1;
  const built = EstimateLine.create({
    id: asEstimateLineId(`00000000-0000-0000-0000-00000000000${lineSeq % 10}`),
    description: "Water heater replacement",
    quantity,
    rate: money(rateCents),
    cost: zeroMoney,
    materialId: null,
    isOptional: false,
    needsPhoto: false,
    position: lineSeq,
    tier: null,
  });
  if (!isOk(built)) throw new Error(built.error.message);
  return built.value;
};

const signature: SignatureDraft = {
  signerName: "Dana Ruiz",
  signatureSvg: "<svg/>",
  signerIp: null,
  signerUserAgent: null,
};

const sell = (rates?: PricingRates, lines = [line(50_000)]): Estimate => {
  const built = Estimate.sellOnSite({
    id: asEstimateId("11111111-1111-1111-1111-111111111111"),
    orgId: ORG,
    num: "EST-1042",
    leadId: LEAD,
    title: "Water heater",
    lines,
    publicToken: "tok",
    signature,
    orgName: "Summit Plumbing",
    now: NOW,
    ...(rates ? { rates } : {}),
  });
  if (!isOk(built)) throw new Error(built.error.message);
  return built.value;
};

describe("Estimate.sellOnSite — rates", () => {
  it("defaults to no discount, no tax and no deposit", () => {
    const e = sell();
    expect(e.rates()).toEqual({ discBps: 0, taxBps: 0, depBps: 0 });
    expect(e.total()).toBe(50_000);
    expect(e.depositDue()).toBe(0);
  });

  it("carries the three rates the tech set instead of hard-coding zero", () => {
    const e = sell({ discBps: 1_000, taxBps: 875, depBps: 2_000 });
    expect(e.props.discBps).toBe(1_000);
    expect(e.props.taxBps).toBe(875);
    expect(e.props.depBps).toBe(2_000);
  });

  it("runs the same chain the office quote does: $500 − 10% + 8.75% tax", () => {
    const e = sell({ discBps: 1_000, taxBps: 875, depBps: 0 });
    expect(e.subtotal()).toBe(50_000);
    expect(e.discountAmount()).toBe(5_000);
    expect(e.netAfterDiscount()).toBe(45_000);
    expect(e.taxAmount()).toBe(3_938);
    expect(e.total()).toBe(48_938);
  });

  it("derives the deposit from the TAX-INCLUSIVE total", () => {
    const e = sell({ discBps: 0, taxBps: 1_000, depBps: 2_000 });
    expect(e.total()).toBe(55_000);
    expect(e.depositDue()).toBe(11_000);
  });

  it("refuses a discount over 100% rather than inverting the bill", () => {
    const built = Estimate.sellOnSite({
      id: asEstimateId("11111111-1111-1111-1111-111111111111"),
      orgId: ORG,
      num: "EST-1042",
      leadId: LEAD,
      title: null,
      lines: [line(50_000)],
      publicToken: null,
      signature,
      orgName: "Summit Plumbing",
      now: NOW,
      rates: { discBps: 10_001, taxBps: 0, depBps: 0 },
    });
    expect(isOk(built)).toBe(false);
  });

  it("refuses a deposit over 100% of the total", () => {
    const built = Estimate.sellOnSite({
      id: asEstimateId("11111111-1111-1111-1111-111111111111"),
      orgId: ORG,
      num: "EST-1042",
      leadId: LEAD,
      title: null,
      lines: [line(50_000)],
      publicToken: null,
      signature,
      orgName: "Summit Plumbing",
      now: NOW,
      rates: { discBps: 0, taxBps: 0, depBps: 10_001 },
    });
    expect(isOk(built)).toBe(false);
  });
});

describe("the signed snapshot", () => {
  it("freezes the TAX-INCLUSIVE total, not the pre-tax subtotal", () => {
    const snap = sell({ discBps: 0, taxBps: 875, depBps: 0 }).props.signedSnapshot;
    expect(snap?.subtotalCents).toBe(50_000);
    expect(snap?.taxCents).toBe(4_375);
    expect(snap?.totalCents).toBe(54_375);
  });

  it("freezes the deposit that was asked for", () => {
    const snap = sell({ discBps: 0, taxBps: 0, depBps: 2_500 }).props.signedSnapshot;
    expect(snap?.depositCents).toBe(12_500);
  });

  it("freezes the discount that came off", () => {
    const snap = sell({ discBps: 1_500, taxBps: 0, depBps: 0 }).props.signedSnapshot;
    expect(snap?.discountCents).toBe(7_500);
    expect(snap?.totalCents).toBe(42_500);
  });
});

/**
 * THE SENTENCE. One case per combination, pinned verbatim — a copy tweak that changes what people
 * are agreeing to has to change these strings, deliberately, in a diff someone reads.
 */
describe("the authorisation sentence the customer signs", () => {
  const auth = (rates?: PricingRates): string =>
    sell(rates).props.signedSnapshot?.authorizationText ?? "";

  it("neither — authorises the flat price, payable on completion", () => {
    expect(auth()).toBe(
      "I authorize Summit Plumbing to perform the work described above for $500.00." +
        " I agree to pay this amount when the work is complete." +
        " This approval is my signature for both the quote and the final bill for this work — " +
        "I will not be asked to sign again for the amount shown here." +
        " Work beyond what is listed above is not included and needs my approval before it is done.",
    );
  });

  it("tax only — the authorised figure INCLUDES the tax", () => {
    expect(auth({ discBps: 0, taxBps: 875, depBps: 0 })).toBe(
      "I authorize Summit Plumbing to perform the work described above for $543.75." +
        " I agree to pay this amount when the work is complete." +
        " This approval is my signature for both the quote and the final bill for this work — " +
        "I will not be asked to sign again for the amount shown here." +
        " Work beyond what is listed above is not included and needs my approval before it is done.",
    );
  });

  it("deposit only — the sentence names the deposit and the balance", () => {
    expect(auth({ discBps: 0, taxBps: 0, depBps: 2_000 })).toBe(
      "I authorize Summit Plumbing to perform the work described above for $500.00." +
        " I agree to pay a deposit of $100.00 now, and the balance when the work is complete." +
        " This approval is my signature for both the quote and the final bill for this work — " +
        "I will not be asked to sign again for the amount shown here." +
        " Work beyond what is listed above is not included and needs my approval before it is done.",
    );
  });

  it("both — a tax-inclusive total and a deposit derived from it", () => {
    expect(auth({ discBps: 0, taxBps: 875, depBps: 2_000 })).toBe(
      "I authorize Summit Plumbing to perform the work described above for $543.75." +
        " I agree to pay a deposit of $108.75 now, and the balance when the work is complete." +
        " This approval is my signature for both the quote and the final bill for this work — " +
        "I will not be asked to sign again for the amount shown here." +
        " Work beyond what is listed above is not included and needs my approval before it is done.",
    );
  });

  it("a discount moves the authorised figure down, and the deposit with it", () => {
    expect(auth({ discBps: 1_000, taxBps: 875, depBps: 2_000 })).toBe(
      "I authorize Summit Plumbing to perform the work described above for $489.38." +
        " I agree to pay a deposit of $97.88 now, and the balance when the work is complete." +
        " This approval is my signature for both the quote and the final bill for this work — " +
        "I will not be asked to sign again for the amount shown here." +
        " Work beyond what is listed above is not included and needs my approval before it is done.",
    );
  });

  it("the sentence tracks the numbers — every combination names its own total", () => {
    const totals = [
      auth(),
      auth({ discBps: 0, taxBps: 875, depBps: 0 }),
      auth({ discBps: 1_000, taxBps: 0, depBps: 0 }),
      auth({ discBps: 1_000, taxBps: 875, depBps: 2_000 }),
    ];
    expect(new Set(totals).size).toBe(4);
  });
});

describe("Estimate.resignOnSite — rates", () => {
  it("replaces the rates when new ones are supplied", () => {
    const first = sell({ discBps: 1_000, taxBps: 875, depBps: 2_000 });
    const again = first.resignOnSite([line(60_000)], signature, "Summit Plumbing", NOW, {
      discBps: 0,
      taxBps: 875,
      depBps: 0,
    });
    if (!isOk(again)) throw new Error(again.error.message);
    expect(again.value.rates()).toEqual({ discBps: 0, taxBps: 875, depBps: 0 });
    expect(again.value.total()).toBe(65_250);
    expect(again.value.props.signedSnapshot?.totalCents).toBe(65_250);
  });

  it("keeps the estimate's existing rates when the caller supplies none", () => {
    const first = sell({ discBps: 1_000, taxBps: 875, depBps: 2_000 });
    const again = first.resignOnSite([line(60_000)], signature, "Summit Plumbing", NOW);
    if (!isOk(again)) throw new Error(again.error.message);
    expect(again.value.rates()).toEqual({ discBps: 1_000, taxBps: 875, depBps: 2_000 });
  });

  it("re-signing rewrites the sentence to the new total", () => {
    const first = sell({ discBps: 0, taxBps: 875, depBps: 0 });
    const again = first.resignOnSite([line(60_000)], signature, "Summit Plumbing", NOW);
    if (!isOk(again)) throw new Error(again.error.message);
    expect(again.value.props.signedSnapshot?.authorizationText).toContain("$652.50");
    expect(first.props.signedSnapshot?.authorizationText).toContain("$543.75");
  });
});
