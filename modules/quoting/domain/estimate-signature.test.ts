import { describe, it, expect } from "vitest";
import {
  asEstimateId,
  asEstimateLineId,
  asOrgId,
  asLeadId,
  money,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Estimate, EstimateLine, type EstimateProps, type EstimateLineProps } from "./estimate";
import { coveredBySignature } from "./signature";

/**
 * Accepting WITH a signature.
 *
 * The invariant under test throughout: the frozen snapshot is built by the estimate from its own
 * final state, so it can never describe a document other than the one that was accepted. Every
 * test here is a way that could go wrong.
 */

let lineSeq = 0;
const line = (overrides: Partial<EstimateLineProps> = {}): EstimateLine => {
  lineSeq += 1;
  const props: EstimateLineProps = {
    id: asEstimateLineId(`00000000-0000-0000-0000-00000000000${lineSeq % 10}`),
    description: "Labor",
    quantity: 1,
    rate: money(10_000),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position: lineSeq,
    tier: null,
    ...overrides,
  };
  const result = EstimateLine.create(props);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
};

const sent = (overrides: Partial<EstimateProps> = {}): Estimate => {
  const props: EstimateProps = {
    id: asEstimateId("11111111-1111-1111-1111-111111111111"),
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    num: "EST-1042",
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    title: "Water heater",
    status: "sent",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: 30,
    sentAt: new Date("2026-08-01T00:00:00Z"),
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeRequest: null,
    publicToken: "a".repeat(64),
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: "Standard terms.",
    lines: [line()],
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
  const result = Estimate.create(props);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
};

const NOW = new Date("2026-08-12T15:04:00Z");
const DRAFT = {
  signerName: "  Dave Chen  ",
  signatureSvg: "M10,10 L40,30",
  signerIp: "203.0.113.9",
  signerUserAgent: "Mozilla/5.0",
};

describe("Estimate.accept with a signature", () => {
  it("records who signed, what they drew, and where from", () => {
    const r = sent().accept(NOW, undefined, DRAFT, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    const p = r.value.props;

    expect(p.signerName).toBe("Dave Chen"); // trimmed by the domain
    expect(p.signatureSvg).toBe("M10,10 L40,30");
    expect(p.signerIp).toBe("203.0.113.9");
    expect(p.signerUserAgent).toBe("Mozilla/5.0");
    expect(p.signedAt).toEqual(NOW);
    expect(p.status).toBe("accepted");
  });

  it("freezes the document — totals in the snapshot match the accepted estimate exactly", () => {
    const e = sent({ discBps: 1_000, taxBps: 825, depBps: 2_500, lines: [line({ rate: money(100_000) })] });
    const r = e.accept(NOW, undefined, DRAFT, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    const snap = r.value.props.signedSnapshot!;

    // Read from the accepted aggregate, not recomputed here: the point is that the frozen copy
    // and the live estimate agree, and a second calculation in the test could hide a drift.
    expect(snap.subtotalCents).toBe(r.value.subtotal());
    expect(snap.discountCents).toBe(r.value.discountAmount());
    expect(snap.taxCents).toBe(r.value.taxAmount());
    expect(snap.totalCents).toBe(r.value.total());
    expect(snap.depositCents).toBe(r.value.depositDue());
    expect(snap.estimateNum).toBe("EST-1042");
    expect(snap.termsText).toBe("Standard terms.");
  });

  it("stores the authorisation sentence verbatim, with the shop and the amount in it", () => {
    const r = sent({ lines: [line({ rate: money(1_950_000) })] }).accept(NOW, undefined, DRAFT, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    const text = r.value.props.signedSnapshot!.authorizationText;

    expect(text).toContain("Bay Plumbing");
    expect(text).toContain("$19,500.00");
    expect(text).toMatch(/both the quote and the final bill/i);
  });

  it("snapshots the RESOLVED tier, not the whole tiered quote", () => {
    // A tiered estimate shows three options; only one is agreed to. Freezing all three would
    // record a document the customer never accepted.
    const e = sent({
      recommendedTier: "better",
      lines: [
        line({ tier: "good", rate: money(20_000) }),
        line({ tier: "better", rate: money(50_000) }),
        line({ tier: "best", rate: money(90_000) }),
      ],
    });
    const r = e.accept(NOW, "better", DRAFT, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    const snap = r.value.props.signedSnapshot!;

    expect(snap.lines).toHaveLength(1);
    expect(snap.totalCents).toBe(50_000);
    expect(snap.chosenTier).toBe("better");
    expect(snap.authorizationText).toContain("$500.00");
  });

  it("accepts a TYPED name with no drawing at all", () => {
    // The typed name is the signature. Aerotek v. Boyd (Tex. 2021) slip op. 13-14 held a printed
    // name qualifies; fn. 22 expressly declined to rule on a finger-drawn mark. Requiring the
    // drawing would gate approval on the weaker evidence and lock out anyone without a pointer.
    const r = sent().accept(NOW, undefined, { ...DRAFT, signatureSvg: "" }, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    expect(r.value.props.status).toBe("accepted");
    expect(r.value.props.signerName).toBe("Dave Chen");
    expect(r.value.props.signatureSvg).toBe("");
    // The rest of the evidence still lands — that is what carries the weight.
    expect(r.value.props.signedAt).toEqual(NOW);
    expect(r.value.props.signerIp).toBe("203.0.113.9");
    expect(r.value.props.signedSnapshot).toBeTruthy();
  });

  it("still refuses a mark that is too large to be a signature", () => {
    // Not a real pen stroke — a payload posted at a public, unauthenticated endpoint.
    const r = sent().accept(NOW, undefined, { ...DRAFT, signatureSvg: "M1,1 " + "L2,2 ".repeat(30_000) }, "Bay Plumbing");
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.field).toBe("signatureSvg");
  });

  it("refuses when the name is blank", () => {
    const r = sent().accept(NOW, undefined, { ...DRAFT, signerName: "   " }, "Bay Plumbing");
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.field).toBe("signerName");
  });

  it("leaves the estimate untouched when the signature is refused", () => {
    // No half-transition: a rejected signature must not leave a "sent" estimate that has silently
    // become accepted, or an accepted one with no evidence.
    const e = sent();
    const r = e.accept(NOW, undefined, { ...DRAFT, signerName: "" }, "Bay Plumbing");
    expect(isOk(r)).toBe(false);
    expect(e.props.status).toBe("sent");
    expect(e.props.signedAt).toBeUndefined();
  });

  it("still accepts with NO signature — the office phone-approval path", () => {
    const r = sent().accept(NOW);
    if (!isOk(r)) throw new Error(r.error.message);
    expect(r.value.props.status).toBe("accepted");
    expect(r.value.props.signedAt ?? null).toBeNull();
    expect(r.value.props.signedSnapshot ?? null).toBeNull();
  });
});

describe("coveredBySignature against a real accepted estimate", () => {
  const signed = () => {
    const r = sent({ lines: [line({ rate: money(2_000_000) })] }).accept(NOW, undefined, DRAFT, "Bay Plumbing");
    if (!isOk(r)) throw new Error(r.error.message);
    return r.value.props.signedSnapshot!;
  };

  it("covers an invoice for the signed amount", () => {
    expect(coveredBySignature(signed(), 2_000_000)).toBe(true);
  });

  it("covers an invoice for less", () => {
    // The $500 deposit against a $20,000 signed job.
    expect(coveredBySignature(signed(), 50_000)).toBe(true);
  });

  it("does NOT cover an invoice for more", () => {
    // One cent over is still unauthorised. The shop needs to know BEFORE sending it.
    expect(coveredBySignature(signed(), 2_000_001)).toBe(false);
  });
});
