import { describe, it, expect } from "vitest";
import { withChangeOrders, checkAuthorization, type Authorization } from "./authorization";
import { asInvoiceId } from "@mallet/shared/types";

/**
 * What the customer has agreed to owe, in total.
 *
 * THE PROBLEM. A job's authorised amount was ONE number from ONE document — the original
 * signature. So the honest sequence — find more work on site, price it, have the customer sign for
 * it — still produced an invoice flagged as exceeding what was authorised. The app could say "this
 * bill is $2,400 over" and had no way to record that they had agreed to the extra.
 *
 * That made the warning worthless. It fired on legitimate work as readily as on unauthorised work,
 * and a warning that cries wolf is one nobody reads. The point of summing signed change orders is
 * not to soften the check — it is to make it MEAN something when it does fire.
 */

const auth = (over: Partial<Authorization> = {}): Authorization => ({
  source: "estimate",
  signerName: "Sam Ortiz",
  signedAt: new Date("2026-07-01T10:00:00Z"),
  documentRef: "EST-1024",
  authorizedCents: 100_000,
  ...over,
});

describe("authorised total", () => {
  it("is the original signature when nothing was added", () => {
    expect(withChangeOrders(auth(), [])?.authorizedCents).toBe(100_000);
  });

  it("adds every signed change order", () => {
    const result = withChangeOrders(auth(), [
      auth({ documentRef: "EST-1099", authorizedCents: 40_000 }),
      auth({ documentRef: "EST-1103", authorizedCents: 15_000 }),
    ]);
    expect(result?.authorizedCents).toBe(155_000);
  });

  // The one that matters: an UNSIGNED add-on is exactly what the warning exists to catch, so it
  // must not quietly raise the authorised amount.
  it("ignores a change order nobody signed", () => {
    const result = withChangeOrders(auth(), [
      auth({ documentRef: "EST-1099", authorizedCents: 40_000, signerName: "   " }),
    ]);
    expect(result?.authorizedCents).toBe(100_000);
  });

  it("keeps the ORIGINAL document on record — a dispute starts there", () => {
    const result = withChangeOrders(auth(), [auth({ documentRef: "EST-1099", authorizedCents: 40_000 })]);
    expect(result?.documentRef).toBe("EST-1024");
    expect(result?.signerName).toBe("Sam Ortiz");
  });

  // Signed add-ons authorise THEMSELVES, not the base work. Unsigned base work stays unsigned.
  it("does not manufacture an authorisation out of add-ons alone", () => {
    expect(withChangeOrders(null, [auth({ authorizedCents: 40_000 })])).toBeNull();
  });
});

describe("the overage warning, end to end", () => {
  const check = (invoiceCents: number, changeOrders: Authorization[] = []) =>
    checkAuthorization({
      invoiceId: asInvoiceId("00000000-0000-4000-8000-000000000001"),
      invoiceTotalCents: invoiceCents,
      authorization: withChangeOrders(auth(), changeOrders),
    });

  it("fires when the bill exceeds what was signed", () => {
    expect(check(124_000).overage?.excessCents).toBe(24_000);
  });

  // The whole point of the change: legitimate extra work stops looking like a violation.
  it("stays SILENT once the extra was signed for", () => {
    const signedExtra = [auth({ documentRef: "EST-1099", authorizedCents: 24_000 })];
    expect(check(124_000, signedExtra).overage).toBeNull();
  });

  it("still fires for the part that was never signed", () => {
    const signedExtra = [auth({ documentRef: "EST-1099", authorizedCents: 24_000 })];
    // $1,300 billed against $1,000 + $240 agreed — $60 of it nobody approved.
    expect(check(130_000, signedExtra).overage?.excessCents).toBe(6_000);
  });
});
