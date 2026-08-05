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
