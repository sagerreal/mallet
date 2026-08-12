import { describe, it, expect } from "vitest";
import {
  defaultPayInstructions,
  defaultReceiptNote,
  defaultChangeOrderAgreement,
  effectiveInvoiceFooter,
  effectivePayInstructions,
  effectiveReceiptNote,
  effectiveChangeOrderAgreement,
  INVOICE_FOOTER_MAX,
  PAY_INSTRUCTIONS_MAX,
  RECEIPT_NOTE_MAX,
  CHANGE_ORDER_AGREEMENT_MAX,
} from "./document-wording";

// The default literals are LOAD-BEARING: an org that never touches Settings → Documents must
// render byte-for-byte what the surfaces hardcoded before the slots existed. These strings are
// asserted verbatim so a copy tweak here shows up as a failing test, not a silent change on
// every shop's documents.

describe("document wording defaults", () => {
  it("payment instructions default names the shop, exactly as the public invoice page did", () => {
    expect(defaultPayInstructions("Rivera Plumbing")).toBe(
      "To pay this invoice, contact Rivera Plumbing directly.",
    );
  });

  it("receipt note default is the public page's settled line, verbatim", () => {
    expect(defaultReceiptNote()).toBe(
      "This invoice is settled in full. Keep this link for your records.",
    );
  });

  it("change-order agreement default keeps both variants of the tech builder's sentence", () => {
    expect(defaultChangeOrderAgreement("Rivera Plumbing", true)).toBe(
      "The customer approves adding the work listed above, at the price shown, to the job they already signed with Rivera Plumbing. It bills with the job.",
    );
    expect(defaultChangeOrderAgreement("Rivera Plumbing", false)).toBe(
      "The customer approves adding the work listed above, at the price shown, to this job with Rivera Plumbing. It bills with the job.",
    );
  });
});

describe("effective wording resolution", () => {
  it("invoice footer has NO default — null/blank override renders nothing", () => {
    expect(effectiveInvoiceFooter(null)).toBeNull();
    expect(effectiveInvoiceFooter(undefined)).toBeNull();
    expect(effectiveInvoiceFooter("")).toBeNull();
    expect(effectiveInvoiceFooter("   ")).toBeNull();
  });

  it("invoice footer override renders trimmed", () => {
    expect(effectiveInvoiceFooter("  1-year warranty on labor.  ")).toBe(
      "1-year warranty on labor.",
    );
  });

  it("payment instructions fall back to the default when the override is absent or blank", () => {
    expect(effectivePayInstructions(null, "Rivera Plumbing")).toBe(
      "To pay this invoice, contact Rivera Plumbing directly.",
    );
    expect(effectivePayInstructions("  ", "Rivera Plumbing")).toBe(
      "To pay this invoice, contact Rivera Plumbing directly.",
    );
    expect(effectivePayInstructions("Zelle to (925) 555-0100.", "Rivera Plumbing")).toBe(
      "Zelle to (925) 555-0100.",
    );
  });

  it("receipt note falls back to the default when the override is absent or blank", () => {
    expect(effectiveReceiptNote(null)).toBe(
      "This invoice is settled in full. Keep this link for your records.",
    );
    expect(effectiveReceiptNote("Paid in full — thank you!")).toBe("Paid in full — thank you!");
  });

  it("change-order agreement override applies verbatim to BOTH job states", () => {
    const custom = "Approved as extra work on this job, billed with the final invoice.";
    expect(effectiveChangeOrderAgreement(custom, "Rivera Plumbing", true)).toBe(custom);
    expect(effectiveChangeOrderAgreement(custom, "Rivera Plumbing", false)).toBe(custom);
  });

  it("change-order agreement falls back to the state-correct default", () => {
    expect(effectiveChangeOrderAgreement(null, "Rivera Plumbing", true)).toBe(
      defaultChangeOrderAgreement("Rivera Plumbing", true),
    );
    expect(effectiveChangeOrderAgreement("", "Rivera Plumbing", false)).toBe(
      defaultChangeOrderAgreement("Rivera Plumbing", false),
    );
  });
});

describe("length caps", () => {
  it("exports the boundary caps the DTO validates with", () => {
    expect(INVOICE_FOOTER_MAX).toBe(500);
    expect(PAY_INSTRUCTIONS_MAX).toBe(500);
    expect(RECEIPT_NOTE_MAX).toBe(500);
    expect(CHANGE_ORDER_AGREEMENT_MAX).toBe(300);
  });
});
