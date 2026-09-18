import { describe, it, expect } from "vitest";
import { asJobId, money, zeroMoney, isOk, deriveTotals, type PricingRates } from "@mallet/shared/types";
import { JobLine } from "./job-execution";
import { buildJobSignature } from "./job-signature";

/**
 * The on-glass signature.
 *
 * The invariant under test: the snapshot is built from the lines about to be written, so a tablet
 * cannot post a document that disagrees with the price it saved.
 */

const JOB = asJobId("11111111-1111-1111-1111-111111111111");

let seq = 0;
const line = (rateCents: number, quantity = 1, description = "Repair"): JobLine => {
  seq += 1;
  const r = JobLine.create({
    id: `00000000-0000-0000-0000-00000000000${seq % 10}`,
    jobId: JOB,
    description,
    quantity,
    rateCents: money(rateCents),
    costCents: zeroMoney,
    position: seq,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const NOW = new Date("2026-08-12T15:04:00Z");
const DRAFT = { signerName: "  Dave Chen  ", signatureSvg: "M10,10 L40,30", signerIp: null, signerUserAgent: null };

describe("buildJobSignature", () => {
  it("freezes the total from the lines being written", () => {
    const r = buildJobSignature({
      draft: DRAFT,
      lines: [line(150_000), line(50_000)],
      orgName: "Bay Plumbing",
      signedAt: NOW,
    });
    if (!isOk(r)) throw new Error(r.error.message);

    expect(r.value.snapshot.totalCents).toBe(200_000);
    expect(r.value.snapshot.subtotalCents).toBe(200_000);
    expect(r.value.snapshot.lines).toHaveLength(2);
    expect(r.value.signerName).toBe("Dave Chen");
    expect(r.value.signedAt).toEqual(NOW);
  });

  it("rounds per line, the way the field modal totals on screen", () => {
    // 1.5 × $9.99 = 1498.5 → 1499. Truncating instead would put a figure in the record one cent
    // off the one the customer was looking at when they signed.
    const r = buildJobSignature({ draft: DRAFT, lines: [line(999, 1.5)], orgName: "Bay Plumbing", signedAt: NOW });
    if (!isOk(r)) throw new Error(r.error.message);
    expect(r.value.snapshot.totalCents).toBe(1_499);
  });

  it("puts the shop and the amount in the sentence, and says the bill needs no second signature", () => {
    const r = buildJobSignature({ draft: DRAFT, lines: [line(2_000_000)], orgName: "Bay Plumbing", signedAt: NOW });
    if (!isOk(r)) throw new Error(r.error.message);
    const text = r.value.snapshot.authorizationText;
    expect(text).toContain("Bay Plumbing");
    expect(text).toContain("$20,000.00");
    expect(text).toMatch(/both the quote and the final bill/i);
  });

  it("records no deposit, tier or terms when no rates were set", () => {
    // A sale with nothing set is the whole price agreed on the spot. Zero is the honest value, and
    // it keeps the shape identical to the web snapshot so one reader serves both.
    const r = buildJobSignature({ draft: DRAFT, lines: [line(50_000)], orgName: "Bay Plumbing", signedAt: NOW });
    if (!isOk(r)) throw new Error(r.error.message);
    expect(r.value.snapshot.depositCents).toBe(0);
    expect(r.value.snapshot.discountCents).toBe(0);
    expect(r.value.snapshot.taxCents).toBe(0);
    expect(r.value.snapshot.chosenTier).toBeNull();
    expect(r.value.snapshot.termsText).toBeNull();
    expect(r.value.snapshot.authorizationText).not.toContain("deposit");
  });

  it("accepts a typed name with no drawing", () => {
    // Same rule as the web path: the typed name IS the signature.
    const r = buildJobSignature({
      draft: { ...DRAFT, signatureSvg: "" },
      lines: [line(50_000)],
      orgName: "Bay Plumbing",
      signedAt: NOW,
    });
    expect(isOk(r)).toBe(true);
  });

  it("refuses a blank name", () => {
    const r = buildJobSignature({
      draft: { ...DRAFT, signerName: "   " },
      lines: [line(50_000)],
      orgName: "Bay Plumbing",
      signedAt: NOW,
    });
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.field).toBe("signerName");
  });

  /**
   * The whole point of the field pricing controls: the sentence must move with the numbers. If a
   * tech charges tax, the customer authorises the tax-inclusive figure — not the pre-tax one they
   * would otherwise be handed and later billed above.
   */
  describe("with rates", () => {
    const withRates = (rates: PricingRates, rateCents = 50_000) =>
      buildJobSignature({ draft: DRAFT, lines: [line(rateCents)], orgName: "Bay Plumbing", signedAt: NOW, rates });

    it("authorises the TAX-INCLUSIVE total", () => {
      const r = withRates({ discBps: 0, taxBps: 875, depBps: 0 });
      if (!isOk(r)) throw new Error(r.error.message);
      expect(r.value.snapshot.subtotalCents).toBe(50_000);
      expect(r.value.snapshot.taxCents).toBe(4_375);
      expect(r.value.snapshot.totalCents).toBe(54_375);
      expect(r.value.snapshot.authorizationText).toContain("$543.75");
      expect(r.value.snapshot.authorizationText).not.toContain("$500.00");
    });

    it("names the deposit in the sentence and derives it from the total", () => {
      const r = withRates({ discBps: 0, taxBps: 875, depBps: 2_000 });
      if (!isOk(r)) throw new Error(r.error.message);
      expect(r.value.snapshot.depositCents).toBe(10_875);
      expect(r.value.snapshot.authorizationText).toContain("deposit of $108.75");
      expect(r.value.snapshot.authorizationText).toContain("balance when the work is complete");
    });

    it("takes the discount off before the tax", () => {
      const r = withRates({ discBps: 1_000, taxBps: 875, depBps: 0 });
      if (!isOk(r)) throw new Error(r.error.message);
      expect(r.value.snapshot.discountCents).toBe(5_000);
      expect(r.value.snapshot.taxCents).toBe(3_938);
      expect(r.value.snapshot.totalCents).toBe(48_938);
    });

    it("matches the estimate's chain figure for figure", () => {
      // The job snapshot and the estimate snapshot describe ONE sale. Same lines, same rates, same
      // total — if these two ever disagree the customer has signed two different documents.
      const rates: PricingRates = { discBps: 1_000, taxBps: 875, depBps: 2_000 };
      const r = withRates(rates);
      if (!isOk(r)) throw new Error(r.error.message);
      const expected = deriveTotals(money(50_000), money(50_000), rates);
      expect(r.value.snapshot.totalCents).toBe(expected.total);
      expect(r.value.snapshot.depositCents).toBe(expected.depositDue);
    });

    it("leaves a no-rates sale bit-for-bit as it was", () => {
      const withNone = buildJobSignature({
        draft: DRAFT,
        lines: [line(50_000)],
        orgName: "Bay Plumbing",
        signedAt: NOW,
        rates: { discBps: 0, taxBps: 0, depBps: 0 },
      });
      const without = buildJobSignature({
        draft: DRAFT,
        lines: [line(50_000)],
        orgName: "Bay Plumbing",
        signedAt: NOW,
      });
      if (!isOk(withNone) || !isOk(without)) throw new Error("expected both to build");
      expect(withNone.value.snapshot.authorizationText).toBe(without.value.snapshot.authorizationText);
      expect(withNone.value.snapshot.totalCents).toBe(without.value.snapshot.totalCents);
    });
  });
});
