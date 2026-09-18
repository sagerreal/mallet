import { describe, it, expect } from "vitest";
import { authorizationText, AUTHORIZATION_VERSION } from "./authorization-text";

const base = { totalCents: 2_000_000, orgName: "Bay Plumbing" };

describe("authorizationText", () => {
  it("names the shop and the exact amount", () => {
    const t = authorizationText(base);
    expect(t).toContain("Bay Plumbing");
    expect(t).toContain("$20,000.00");
  });

  it("says this signature covers the final bill too", () => {
    // The whole reason the feature exists: a customer who says "I only signed the estimate, I
    // never signed an invoice". The sentence has to close that door out loud.
    const t = authorizationText(base);
    expect(t).toMatch(/both the quote and the final bill/i);
    expect(t).toMatch(/will not be asked to sign again/i);
  });

  it("bounds itself to the stated work", () => {
    // The honest other half, and the prose twin of coveredBySignature: extra work is not covered.
    expect(authorizationText(base)).toMatch(/needs my approval before it is done/i);
  });

  it("asks for the deposit only when there is one", () => {
    const withDeposit = authorizationText({ ...base, depositCents: 50_000 });
    expect(withDeposit).toContain("deposit of $500.00");
    expect(withDeposit).toContain("balance when the work is complete");

    const none = authorizationText({ ...base, depositCents: 0 });
    expect(none).not.toContain("deposit");
    expect(none).toContain("pay this amount when the work is complete");
  });

  it("is stable for the same inputs", () => {
    // Two renders must be byte-identical: the page shows one and the server stores the other, and
    // a difference between them is precisely the discrepancy a customer would point at.
    expect(authorizationText(base)).toBe(authorizationText(base));
  });

  it("carries a version so a wording change is traceable", () => {
    expect(AUTHORIZATION_VERSION).toBeGreaterThan(0);
  });
});
