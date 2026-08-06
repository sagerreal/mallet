import { describe, it, expect } from "vitest";
import type { Invoice } from "@/lib/store/types";
import { invoiceDocumentView } from "./invoice-document-view";

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: "inv-1",
  num: "INV-1852",
  jobId: "job-1",
  leadId: "lead-1",
  cust: "Dana Reyes",
  phone: "(704) 555-0134",
  title: "Water heater replacement",
  status: "sent",
  termsDays: 30,
  // Midday UTC, so the rendered day is the same in every timezone the test might run in.
  dueAt: "2026-09-02T12:00:00.000Z",
  lines: [
    { d: "Water heater — 50 gal", q: 1, r: 145 },
    { d: "Shut-off valve", q: 2, r: 20 },
  ],
  total: 185,
  depPaid: 0,
  payments: [],
  age: 0,
  archived: false,
  ...over,
});

describe("invoiceDocumentView", () => {
  it("converts the store's dollars to the document's integer cents", () => {
    const view = invoiceDocumentView(inv());
    expect(view.totalCents).toBe(18_500);
    expect(view.balanceDueCents).toBe(18_500);
  });

  it("rounds cents rather than truncating — 89.5 dollars is 8950, not 8949", () => {
    // 89.5 * 100 is 8949.999999999999 in binary floating point. A truncating cast bills $89.49.
    const view = invoiceDocumentView(inv({ total: 89.5, lines: [{ d: "Diagnostic", q: 1, r: 89.5 }] }));
    expect(view.totalCents).toBe(8_950);
    expect(view.lines[0]?.amountCents).toBe(8_950);
  });

  it("extends each line by its quantity", () => {
    const view = invoiceDocumentView(inv());
    expect(view.lines[1]).toEqual({
      description: "Shut-off valve",
      quantity: 2,
      amountCents: 4_000,
      // Absent `notax` on the store line is a taxable line.
      taxable: true,
    });
  });

  it("takes the total off the record, never a re-sum of the lines", () => {
    // A bill raised from a quote carries the agreed total with NO lines at all.
    const view = invoiceDocumentView(inv({ lines: [], total: 4_200 }));
    expect(view.lines).toEqual([]);
    expect(view.totalCents).toBe(420_000);
  });

  it("credits the deposit and everything already paid", () => {
    const view = invoiceDocumentView(
      inv({ depPaid: 50, payments: [{ amt: 25, when: "Just now", method: "cash" }] }),
    );
    expect(view.depositPaidCents).toBe(5_000);
    expect(view.amountPaidCents).toBe(2_500);
    expect(view.balanceDueCents).toBe(11_000);
  });

  it("carries the Net terms + due date + PO face line while the bill is open", () => {
    expect(invoiceDocumentView(inv({ poNumber: "4471" })).termsFace).toBe("Net 30 · due Sep 2 · PO 4471");
  });

  it("drops Net terms and the due date once settled, but keeps the PO", () => {
    // A due date on a receipt is noise; a PO number is a permanent reference.
    expect(invoiceDocumentView(inv({ status: "paid", poNumber: "4471" })).termsFace).toBe("PO 4471");
  });

  it("states NO balance on a canceled bill", () => {
    // Nothing is owed on a void invoice, and "Balance due $0.00" would read as "settled".
    expect(invoiceDocumentView(inv({ status: "void" })).balanceDueCents).toBeNull();
  });

  it("prefers the server's balance on a summary row over re-deriving it from parts it lacks", () => {
    const view = invoiceDocumentView(inv({ partial: true, due: 85, total: 185, depPaid: 0, payments: [] }));
    expect(view.balanceDueCents).toBe(8_500);
  });
});

describe("invoiceDocumentView — the document-of-record half", () => {
  it("states who was billed and where the work happened", () => {
    const view = invoiceDocumentView(
      inv({ serviceAddress: "18 Aspen Ct, Dublin, CA 94568" }),
    );
    expect(view.parties).toEqual({
      customerName: "Dana Reyes",
      serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
    });
  });

  it("leaves a missing service address null so the document omits the block", () => {
    // Most leads are created without an address. A blank "Service address" reads as a bug.
    expect(invoiceDocumentView(inv()).parties.serviceAddress).toBeNull();
  });

  it("states the invoice date and the service date as two separate facts", () => {
    const view = invoiceDocumentView(
      inv({ createdAt: "2026-08-05T18:00:00.000Z", serviceAt: "2026-08-03T16:20:00.000Z" }),
    );
    expect(view.dates.invoicedAt).toBe("2026-08-05T18:00:00.000Z");
    expect(view.dates.serviceAt).toBe("2026-08-03T16:20:00.000Z");
  });

  it("NEVER substitutes the invoice date for an unknown service date", () => {
    // A customer may hand this to an insurer or a warranty desk.
    const view = invoiceDocumentView(inv({ createdAt: "2026-08-05T18:00:00.000Z" }));
    expect(view.dates.invoicedAt).toBe("2026-08-05T18:00:00.000Z");
    expect(view.dates.serviceAt).toBeNull();
  });

  it("carries no due date of its own — termsFace already prints one", () => {
    // Two Due segments on one strip would print the same date twice.
    expect(invoiceDocumentView(inv()).dates.dueAt).toBeUndefined();
  });

  it("omits the identity block entirely when the caller has none to give", () => {
    expect(invoiceDocumentView(inv()).business).toBeUndefined();
  });

  it("passes the caller's identity block through untouched", () => {
    const business = {
      name: "Ridgeline Plumbing",
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: null,
      site: null,
      license: "C36-1029384",
    };
    expect(invoiceDocumentView(inv(), business).business).toEqual(business);
  });
});
