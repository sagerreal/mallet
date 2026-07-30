import { describe, it, expect } from "vitest";
import { asJobId, money, zeroMoney, isOk } from "@mallet/shared/types";
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

  it("records no deposit, tier or terms rather than inventing them", () => {
    // An on-site approval is the whole price agreed on the spot. Empty is the honest value, and it
    // keeps the shape identical to the web snapshot so one reader serves both.
    const r = buildJobSignature({ draft: DRAFT, lines: [line(50_000)], orgName: "Bay Plumbing", signedAt: NOW });
    if (!isOk(r)) throw new Error(r.error.message);
    expect(r.value.snapshot.depositCents).toBe(0);
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
});
