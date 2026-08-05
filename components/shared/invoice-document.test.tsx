// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvoiceDocument, type InvoiceDocumentProps } from "./invoice-document";

const doc = (over: Partial<InvoiceDocumentProps> = {}): InvoiceDocumentProps => ({
  num: "INV-1852",
  termsFace: "Net 30 · due Sep 2",
  title: "Water heater replacement",
  lines: [
    { description: "Water heater — 50 gal", quantity: 1, amountCents: 145_00 },
    { description: "Shut-off valve", quantity: 2, amountCents: 40_00 },
  ],
  totalCents: 185_00,
  taxCents: 0,
  depositPaidCents: 0,
  amountPaidCents: 0,
  balanceDueCents: 185_00,
  ...over,
});

describe("InvoiceDocument", () => {
  it("itemises each line with its extended amount", () => {
    render(<InvoiceDocument {...doc()} />);
    expect(screen.getByText("Water heater — 50 gal")).toBeTruthy();
    expect(screen.getByText("$145.00")).toBeTruthy();
    expect(screen.getByText("$40.00")).toBeTruthy();
  });

  it("shows × qty only when the quantity is not 1", () => {
    render(<InvoiceDocument {...doc()} />);
    // "× 2" rides in the same span as the description.
    expect(screen.getByText("Shut-off valve × 2")).toBeTruthy();
    expect(screen.queryByText(/Water heater — 50 gal × /)).toBeNull();
  });

  it("names the invoice and its terms on one meta line", () => {
    render(<InvoiceDocument {...doc()} />);
    expect(screen.getByText("Invoice INV-1852 · Net 30 · due Sep 2")).toBeTruthy();
  });

  it("omits the invoice number when the surface's own header already carries it", () => {
    render(<InvoiceDocument {...doc({ num: undefined })} />);
    expect(screen.getByText("Net 30 · due Sep 2")).toBeTruthy();
    expect(screen.queryByText(/Invoice INV-1852/)).toBeNull();
  });

  it("splits subtotal and tax ONLY when tax was recorded", () => {
    render(<InvoiceDocument {...doc({ totalCents: 200_00, taxCents: 15_00, balanceDueCents: 200_00 })} />);
    // Total is tax-INCLUSIVE, so the subtotal is total − tax, never a re-sum of the lines
    // (which would read $185.00 here only by coincidence — the lines happen to sum to that).
    expect(screen.getByText("Subtotal")).toBeTruthy();
    expect(screen.getByText("$185.00")).toBeTruthy();
    expect(screen.getByText("Tax")).toBeTruthy();
    expect(screen.getByText("$15.00")).toBeTruthy();
    expect(screen.getAllByText("$200.00").length).toBe(2); // Total + Balance due
  });

  it("prints no subtotal/tax rows on a tax-free bill", () => {
    render(<InvoiceDocument {...doc()} />);
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.queryByText("Tax")).toBeNull();
  });

  it("credits a deposit and prior payments as negatives, then states the balance", () => {
    render(
      <InvoiceDocument
        {...doc({ depositPaidCents: 50_00, amountPaidCents: 25_00, balanceDueCents: 110_00 })}
      />,
    );
    expect(screen.getByText("Deposit credit")).toBeTruthy();
    expect(screen.getByText("−$50.00")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("−$25.00")).toBeTruthy();
    expect(screen.getByText("Balance due")).toBeTruthy();
    expect(screen.getByText("$110.00")).toBeTruthy();
  });

  it("states NO balance when the caller passes null — a canceled bill owes nothing", () => {
    // "Balance due $0.00" on a voided invoice reads as "settled", which it is not.
    render(<InvoiceDocument {...doc({ balanceDueCents: null })} />);
    expect(screen.queryByText("Balance due")).toBeNull();
  });

  it("renders cents, never a rounded dollar — a bill that disagrees with the ledger gets argued with", () => {
    render(
      <InvoiceDocument
        {...doc({
          lines: [{ description: "Diagnostic", quantity: 1, amountCents: 89_50 }],
          totalCents: 89_50,
          balanceDueCents: 89_50,
        })}
      />,
    );
    expect(screen.getAllByText("$89.50").length).toBeGreaterThan(0);
  });

  it("lists each payment with its date, method and amount — what makes it a receipt", () => {
    render(
      <InvoiceDocument
        {...doc({
          amountPaidCents: 185_00,
          balanceDueCents: 0,
          payments: [
            { amountCents: 185_00, method: "cash", receivedAt: "2026-08-05T16:30:00.000Z" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Payments received")).toBeTruthy();
    expect(screen.getByText(/Aug 5 · Cash/)).toBeTruthy();
  });

  it("labels every payment method a customer can be handed, and never leaks a raw enum", () => {
    render(
      <InvoiceDocument
        {...doc({
          payments: [
            { amountCents: 1_00, method: "ach", receivedAt: "2026-08-05T16:30:00.000Z" },
            { amountCents: 2_00, method: "card_terminal", receivedAt: "2026-08-05T16:30:00.000Z" },
            { amountCents: 3_00, method: "check", receivedAt: "2026-08-05T16:30:00.000Z" },
            { amountCents: 4_00, method: "wampum", receivedAt: "2026-08-05T16:30:00.000Z" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Bank transfer/)).toBeTruthy();
    expect(screen.getByText(/Card/)).toBeTruthy();
    expect(screen.getByText(/Check/)).toBeTruthy();
    expect(screen.getByText(/Payment$/)).toBeTruthy();
    expect(screen.queryByText(/wampum/)).toBeNull();
  });

  it("renders no payments block when none are supplied", () => {
    render(<InvoiceDocument {...doc()} />);
    expect(screen.queryByText("Payments received")).toBeNull();
  });

  it("renders a lineless bill (raised from a quote) without a phantom $0 subtotal", () => {
    render(<InvoiceDocument {...doc({ lines: [], totalCents: 4_200_00, balanceDueCents: 4_200_00 })} />);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getAllByText("$4,200.00").length).toBe(2);
  });
});

// ── The document-of-record blocks ────────────────────────────────────────────
// Every one is optional, and the rule they all share is: NEVER print a label with no value.

describe("InvoiceDocument business block", () => {
  it("prints who billed the customer, with the licence prefixed", () => {
    render(
      <InvoiceDocument
        {...doc({
          business: {
            name: "Rivera Plumbing",
            address: "200 Ray St, Pleasanton, CA 94566",
            phone: "(925) 555-0100",
            email: "billing@rivera.com",
            site: "riveraplumbing.com",
            license: "C36-1029384",
          },
        })}
      />,
    );
    expect(screen.getByText("Rivera Plumbing")).toBeTruthy();
    expect(screen.getByText("200 Ray St, Pleasanton, CA 94566")).toBeTruthy();
    expect(screen.getByText("(925) 555-0100")).toBeTruthy();
    expect(screen.getByText("billing@rivera.com")).toBeTruthy();
    expect(screen.getByText("riveraplumbing.com")).toBeTruthy();
    expect(screen.getByText("Lic. C36-1029384")).toBeTruthy();
  });

  it("omits the name when the surface's own branded header already prints it", () => {
    // The public page and the office preview both sit under a custhead naming the shop.
    render(<InvoiceDocument {...doc({ business: { address: "200 Ray St", phone: "(925) 555-0100" } })} />);
    expect(screen.queryByText("Rivera Plumbing")).toBeNull();
    expect(screen.getByText("200 Ray St")).toBeTruthy();
  });

  it("prints nothing at all for a shop that has filled none of it in", () => {
    const { container } = render(
      <InvoiceDocument {...doc({ business: { address: null, phone: null, email: null, license: null } })} />,
    );
    expect(screen.queryByText(/Lic\./)).toBeNull();
    // No stray empty rows above the meta line.
    expect(container.textContent).not.toMatch(/Lic\.\s*$/);
  });

  it("treats a whitespace-only value as absent — no empty licence row", () => {
    render(<InvoiceDocument {...doc({ business: { name: "Rivera Plumbing", license: "   " } })} />);
    expect(screen.queryByText(/Lic\./)).toBeNull();
  });
});

describe("InvoiceDocument meta strip", () => {
  it("states the invoice, both dates and the PO on one line, with the year", () => {
    render(
      <InvoiceDocument
        {...doc({
          num: "1042",
          termsFace: "Net 30",
          dates: {
            invoicedAt: "2026-08-05T12:00:00.000Z",
            serviceAt: "2026-08-03T12:00:00.000Z",
            dueAt: "2026-08-12T12:00:00.000Z",
          },
          poNumber: "88-1191",
        })}
      />,
    );
    expect(
      screen.getByText(
        "Invoice 1042 · Invoiced Aug 5, 2026 · Service Aug 3, 2026 · Net 30 · Due Aug 12, 2026 · PO 88-1191",
      ),
    ).toBeTruthy();
  });

  it("omits a date the record does not have rather than inventing one", () => {
    // No completed visit means no service date. Falling back to the invoice date and labelling it
    // "Service" would print something untrue on a page a customer may hand to an insurer.
    render(
      <InvoiceDocument
        {...doc({ num: "1042", termsFace: "", dates: { invoicedAt: "2026-08-05T12:00:00.000Z", serviceAt: null } })}
      />,
    );
    expect(screen.getByText("Invoice 1042 · Invoiced Aug 5, 2026")).toBeTruthy();
    expect(screen.queryByText(/Service/)).toBeNull();
  });

  it("collapses to the pre-existing line when no dates and no PO are supplied", () => {
    render(<InvoiceDocument {...doc()} />);
    expect(screen.getByText("Invoice INV-1852 · Net 30 · due Sep 2")).toBeTruthy();
  });

  it("skips a blank PO number", () => {
    render(<InvoiceDocument {...doc({ poNumber: "  " })} />);
    expect(screen.queryByText(/PO /)).toBeNull();
  });
});

describe("InvoiceDocument parties block", () => {
  it("names who was billed and where the work happened", () => {
    render(
      <InvoiceDocument
        {...doc({ parties: { customerName: "Dana Whitfield", serviceAddress: "18 Elm Ct, Dublin, CA" } })}
      />,
    );
    expect(screen.getByText("Bill to")).toBeTruthy();
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
    expect(screen.getByText("Service address")).toBeTruthy();
    expect(screen.getByText("18 Elm Ct, Dublin, CA")).toBeTruthy();
  });

  it("omits the Service address block entirely when the lead has no address", () => {
    // Most leads are created without one (see leads.address) — a blank labelled block is the
    // documented failure this rule exists to prevent.
    render(<InvoiceDocument {...doc({ parties: { customerName: "Dana Whitfield", serviceAddress: null } })} />);
    expect(screen.getByText("Bill to")).toBeTruthy();
    expect(screen.queryByText("Service address")).toBeNull();
  });

  it("renders no block at all when neither party fact is known", () => {
    render(<InvoiceDocument {...doc({ parties: { customerName: null, serviceAddress: null } })} />);
    expect(screen.queryByText("Bill to")).toBeNull();
    expect(screen.queryByText("Service address")).toBeNull();
  });
});
