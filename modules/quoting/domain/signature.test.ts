import { describe, it, expect } from "vitest";
import { createSignature, coveredBySignature, type SignedSnapshot } from "./signature";
import { isOk } from "@mallet/shared/types";

const snapshot = (over: Partial<SignedSnapshot> = {}): SignedSnapshot => ({
  estimateNum: "Q-1042",
  lines: [{ description: "Repipe", quantity: 1, rateCents: 2_000_000, isOptional: false, tier: null, included: true }],
  subtotalCents: 2_000_000,
  discountCents: 0,
  taxCents: 0,
  totalCents: 2_000_000,
  depositCents: 50_000,
  chosenTier: null,
  termsText: "Net 15.",
  authorizationText: "I authorize this work and agree to pay $20,000.00 on completion.",
  ...over,
});

const input = (over = {}) => ({
  signerName: "Dave Chen",
  signatureSvg: "M0,20 L10,0 L20,20",
  signerIp: "203.0.113.4",
  signerUserAgent: "Mozilla/5.0",
  signedAt: new Date("2026-08-12T14:12:00Z"),
  snapshot: snapshot(),
  ...over,
});

describe("createSignature", () => {
  it("captures name, mark, ip, agent and the frozen document together", () => {
    const r = createSignature(input());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.signerName).toBe("Dave Chen");
      expect(r.value.snapshot.totalCents).toBe(2_000_000);
      expect(r.value.snapshot.authorizationText).toContain("agree to pay");
    }
  });

  it("REQUIRES a typed name — a mark alone attributes the act to nobody", () => {
    expect(isOk(createSignature(input({ signerName: "   " })))).toBe(false);
  });

  it("REQUIRES a drawn mark — a name alone is the click-to-approve this replaces", () => {
    expect(isOk(createSignature(input({ signatureSvg: "" })))).toBe(false);
  });

  it("refuses a signature with no record of what was authorized", () => {
    // A signature pointing at nothing is the exact defect this feature exists to fix, so it must
    // not be storable even by a caller mistake.
    const r = createSignature(input({ snapshot: snapshot({ authorizationText: "  " }) }));
    expect(isOk(r)).toBe(false);
  });

  it("trims the name so trailing whitespace is not part of the attribution", () => {
    const r = createSignature(input({ signerName: "  Dave Chen  " }));
    if (isOk(r)) expect(r.value.signerName).toBe("Dave Chen");
  });

  it("rejects an absurdly large mark rather than storing it", () => {
    // This endpoint is public and unauthenticated; a megabyte of "signature" is a bug or an abuse.
    expect(isOk(createSignature(input({ signatureSvg: "M".repeat(200_000) })))).toBe(false);
  });

  it("accepts a missing ip or user agent — they are context, not the attribution", () => {
    expect(isOk(createSignature(input({ signerIp: null, signerUserAgent: null })))).toBe(true);
  });

  it("records whether each optional line was actually included", () => {
    // An add-on the customer left unticked is not part of what they agreed to pay for, and the
    // snapshot has to say so or the total cannot be explained from the lines.
    const r = createSignature(
      input({
        snapshot: snapshot({
          lines: [
            { description: "Repipe", quantity: 1, rateCents: 2_000_000, isOptional: false, tier: null, included: true },
            { description: "Water heater", quantity: 1, rateCents: 300_000, isOptional: true, tier: null, included: false },
          ],
        }),
      }),
    );
    if (isOk(r)) expect(r.value.snapshot.lines[1]?.included).toBe(false);
  });
});

describe("coveredBySignature", () => {
  it("covers an invoice for exactly the signed amount", () => {
    expect(coveredBySignature(snapshot(), 2_000_000)).toBe(true);
  });

  it("covers an invoice for LESS — nobody disputes being charged less", () => {
    expect(coveredBySignature(snapshot(), 1_500_000)).toBe(true);
  });

  it("does NOT cover an invoice for more than was signed", () => {
    // The $500-deposit-then-$19,500-balance case: the excess was never authorized, and it is the
    // part a customer can refuse with cause. The shop needs to know BEFORE sending.
    expect(coveredBySignature(snapshot(), 2_000_001)).toBe(false);
    expect(coveredBySignature(snapshot(), 2_500_000)).toBe(false);
  });
});
