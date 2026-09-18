import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import { OrgSettings, type OrgSettingsProps } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

// The document-wording subset: the four editable sentences a customer document renders.
// Sibling of org-settings.business.test.ts — business is WHO billed, this is what the
// document SAYS. Null everywhere = the standard wording ships unchanged.
const make = (o: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const r = OrgSettings.create(baseSettingsProps(o));
  if (!isOk(r)) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

const NOW = new Date("2026-08-11T12:00:00Z");

describe("OrgSettings document wording on create", () => {
  it("defaults every document field to null when not supplied", () => {
    const s = make();
    expect(s.props.docInvoiceFooter).toBeNull();
    expect(s.props.docInvoicePayInstructions).toBeNull();
    expect(s.props.docInvoiceReceiptNote).toBeNull();
    expect(s.props.docChangeOrderAgreement).toBeNull();
  });

  it("trims surrounding whitespace off supplied values", () => {
    const s = make({
      docInvoiceFooter: "  Thanks for your business — 1-year warranty on labor.  ",
      docInvoicePayInstructions: " Zelle to (925) 555-0100. ",
      docInvoiceReceiptNote: "\tPaid in full — keep this for your records.\n",
      docChangeOrderAgreement: "  Approved as extra work on this job. ",
    });
    expect(s.props.docInvoiceFooter).toBe("Thanks for your business — 1-year warranty on labor.");
    expect(s.props.docInvoicePayInstructions).toBe("Zelle to (925) 555-0100.");
    expect(s.props.docInvoiceReceiptNote).toBe("Paid in full — keep this for your records.");
    expect(s.props.docChangeOrderAgreement).toBe("Approved as extra work on this job.");
  });

  it("normalises a blank or whitespace-only value to null", () => {
    // One representation for "use the standard wording". A blank override must never render
    // as an empty line where the standard sentence should have been.
    const s = make({
      docInvoiceFooter: "",
      docInvoicePayInstructions: "   ",
      docInvoiceReceiptNote: "\t",
      docChangeOrderAgreement: "\n ",
    });
    expect(s.props.docInvoiceFooter).toBeNull();
    expect(s.props.docInvoicePayInstructions).toBeNull();
    expect(s.props.docInvoiceReceiptNote).toBeNull();
    expect(s.props.docChangeOrderAgreement).toBeNull();
  });
});

describe("OrgSettings.patchDocuments", () => {
  it("patches all four fields and stamps updatedAt", () => {
    const r = make().patchDocuments(
      {
        invoiceFooter: "Thanks for your business.",
        payInstructions: "Mail checks to 200 Ray St.",
        receiptNote: "Paid in full — thank you.",
        changeOrderAgreement: "Approved as extra work, billed with the job.",
      },
      NOW,
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.docInvoiceFooter).toBe("Thanks for your business.");
      expect(r.value.props.docInvoicePayInstructions).toBe("Mail checks to 200 Ray St.");
      expect(r.value.props.docInvoiceReceiptNote).toBe("Paid in full — thank you.");
      expect(r.value.props.docChangeOrderAgreement).toBe(
        "Approved as extra work, billed with the job.",
      );
      expect(r.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
    }
  });

  it("undefined keeps current, explicit null clears back to the standard wording", () => {
    const seeded = make({
      docInvoiceFooter: "Thanks for your business.",
      docInvoicePayInstructions: "Zelle to (925) 555-0100.",
    });
    const r = seeded.patchDocuments({ payInstructions: null }, NOW); // footer untouched
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.docInvoicePayInstructions).toBeNull();
      expect(r.value.props.docInvoiceFooter).toBe("Thanks for your business.");
    }
  });

  it("clearing a field to whitespace stores null, not a space", () => {
    const seeded = make({ docInvoiceReceiptNote: "Paid in full." });
    const r = seeded.patchDocuments({ receiptNote: "   " }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.docInvoiceReceiptNote).toBeNull();
  });

  it("returns a NEW instance and leaves the original untouched", () => {
    const seeded = make({ docInvoiceFooter: "Old footer." });
    const r = seeded.patchDocuments({ invoiceFooter: "New footer." }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).not.toBe(seeded);
    expect(seeded.props.docInvoiceFooter).toBe("Old footer.");
  });

  it("does not disturb business identity or brand fields", () => {
    const seeded = make({ brandName: "Rivera Plumbing", bizPhone: "(925) 555-0100" });
    const r = seeded.patchDocuments({ invoiceFooter: "Thanks!" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.brandName).toBe("Rivera Plumbing");
      expect(r.value.props.bizPhone).toBe("(925) 555-0100");
    }
  });
});
