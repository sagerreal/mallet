import { describe, it, expect } from "vitest";
import { asInvoiceId } from "@mallet/shared/types";
import { checkAuthorization, resolveAuthorization, type Authorization } from "./authorization";

const INV = asInvoiceId("11111111-1111-1111-1111-111111111111");

const auth = (over: Partial<Authorization> = {}): Authorization => ({
  source: "estimate",
  signerName: "Dave Chen",
  signedAt: new Date("2026-08-12T15:04:00Z"),
  documentRef: "EST-1042",
  authorizedCents: 2_000_000,
  ...over,
});

describe("checkAuthorization", () => {
  it("says nothing when the bill matches what was signed", () => {
    const r = checkAuthorization({ invoiceId: INV, invoiceTotalCents: 2_000_000, authorization: auth() });
    expect(r.overage).toBeNull();
    expect(r.authorization?.signerName).toBe("Dave Chen");
  });

  it("says nothing when the bill is LOWER", () => {
    // Nobody disputes being charged less than they agreed to.
    expect(checkAuthorization({ invoiceId: INV, invoiceTotalCents: 50_000, authorization: auth() }).overage).toBeNull();
  });

  it("flags the excess when the bill EXCEEDS what was signed", () => {
    // The $20,000 signed job that went out as $35,000.
    const r = checkAuthorization({ invoiceId: INV, invoiceTotalCents: 3_500_000, authorization: auth() });
    expect(r.overage).not.toBeNull();
    expect(r.overage!.excessCents).toBe(1_500_000);
    expect(r.overage!.authorizedCents).toBe(2_000_000);
    expect(r.overage!.invoicedCents).toBe(3_500_000);
  });

  it("flags one cent over — the line is the line", () => {
    expect(checkAuthorization({ invoiceId: INV, invoiceTotalCents: 2_000_001, authorization: auth() }).overage)
      .not.toBeNull();
  });

  it("does NOT warn when nobody ever signed", () => {
    // No signed amount means nothing to exceed. Warning here would train people to dismiss the
    // banner, and it only works if it is rare and always means something.
    const r = checkAuthorization({ invoiceId: INV, invoiceTotalCents: 9_999_999, authorization: null });
    expect(r.overage).toBeNull();
    expect(r.authorization).toBeNull();
  });

  it("keeps 'unsigned' distinguishable from 'signed and within'", () => {
    // Both have overage === null. The caller has to be able to tell them apart, because one is
    // "we hold evidence for this bill" and the other is "we hold none".
    const unsigned = checkAuthorization({ invoiceId: INV, invoiceTotalCents: 100, authorization: null });
    const within = checkAuthorization({ invoiceId: INV, invoiceTotalCents: 100, authorization: auth() });
    expect(unsigned.authorization).toBeNull();
    expect(within.authorization).not.toBeNull();
  });
});

describe("resolveAuthorization", () => {
  it("prefers the JOB signature over the estimate's", () => {
    // A price signed on the tablet at the kitchen table supersedes what was approved on the web a
    // week earlier — it is the most recent thing the customer actually agreed to.
    const job = auth({ source: "job", documentRef: "JOB-1007", authorizedCents: 2_500_000 });
    const est = auth();
    expect(resolveAuthorization(job, est)?.source).toBe("job");
    expect(resolveAuthorization(job, est)?.authorizedCents).toBe(2_500_000);
  });

  it("falls back to the estimate when the job was never signed on site", () => {
    expect(resolveAuthorization(null, auth())?.source).toBe("estimate");
  });

  it("returns null when neither was signed", () => {
    expect(resolveAuthorization(null, null)).toBeNull();
  });
});
