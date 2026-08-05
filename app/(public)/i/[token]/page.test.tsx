// @vitest-environment jsdom
/**
 * app/(public)/i/[token]/page.test.tsx
 *
 * The public pay page's face line — "Net 30 · due Sep 2 · PO 4471" — is now built by the
 * shared features/invoices/terms-line.ts helper (Task 9) instead of its own inline Net/PO
 * markup. This guards the page's WIRING of that helper: getPublicInvoice is mocked (no DB), the
 * async Server Component is invoked directly and its resolved element tree rendered — the same
 * approach this page's sibling (/q/[token]) uses for its extracted pure pieces, applied here to
 * the page itself since the behavior under test IS the page's own gating (Net/due suppressed
 * once settled; PO stays on the line regardless).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PublicInvoiceView } from "@/modules/invoicing/app/public-invoice";

const getPublicInvoiceMock = vi.fn();

vi.mock("@/modules/invoicing/app/public-invoice", () => ({
  getPublicInvoice: (...a: unknown[]) => getPublicInvoiceMock(...a),
}));
vi.mock("./PayInvoiceButton", () => ({ PayInvoiceButton: () => null }));

import PublicInvoicePage from "./page";

const TOKEN = "a".repeat(64);

function view(over: Partial<PublicInvoiceView> = {}): PublicInvoiceView {
  return {
    num: "INV-810",
    title: "Deck rebuild",
    lines: [{ description: "Labor", quantity: 1, rateCents: 100_00, taxable: true }],
    payments: [],
    totalCents: 100_00,
    taxCents: 0,
    discountCents: 0,
    depositPaidCents: 0,
    amountPaidCents: 0,
    balanceDueCents: 100_00,
    status: "sent",
    termsDays: 7,
    dueAt: null,
    poNumber: null,
    orgName: "Rivera Plumbing",
    chargesEnabled: false,
    // The document-of-record block. An unfilled shop and an addressless lead are the DEFAULT here
    // on purpose: the invariant these tests protect is that nothing unset ever prints a label.
    business: { address: null, phone: null, email: null, site: null, license: null },
    customerName: null,
    serviceAddress: null,
    invoicedAt: new Date("2026-08-05T18:00:00.000Z"),
    serviceAt: null,
    ...over,
  };
}

async function renderPage() {
  const el = await PublicInvoicePage({ params: Promise.resolve({ token: TOKEN }) });
  render(el);
}

describe("PublicInvoicePage — the shared terms-line face line", () => {
  it("renders Net + due + PO — the full shape", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({ termsDays: 30, dueAt: new Date("2026-09-02T18:00:00.000Z"), poNumber: "4471" }),
    );
    await renderPage();
    // The face line now sits inside the one meta strip, after the invoice date, so these assert
    // the SEGMENT rather than the whole text node.
    expect(screen.getByText(/Net 30 · due Sep 2 · PO 4471/)).toBeTruthy();
  });

  it("on-receipt (termsDays 0) shows the due date without 'Net 0'", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({ termsDays: 0, dueAt: new Date("2026-09-02T18:00:00.000Z"), poNumber: null }),
    );
    await renderPage();
    expect(screen.getByText(/due Sep 2/)).toBeTruthy();
    expect(screen.queryByText(/Net 0/)).toBeNull();
  });

  it("suppresses Net/due once PAID but keeps the PO — a due date is meaningless on a receipt", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({
        status: "paid",
        termsDays: 30,
        dueAt: new Date("2026-09-02T18:00:00.000Z"),
        poNumber: "4471",
        amountPaidCents: 100_00,
        balanceDueCents: 0,
      }),
    );
    await renderPage();
    expect(screen.getByText(/PO 4471/)).toBeTruthy();
    expect(screen.queryByText(/Net 30/)).toBeNull();
    expect(screen.queryByText(/due Sep/)).toBeNull();
  });

  it("suppresses Net/due once VOID but keeps the PO", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({
        status: "void",
        termsDays: 30,
        dueAt: new Date("2026-09-02T18:00:00.000Z"),
        poNumber: "4471",
      }),
    );
    await renderPage();
    expect(screen.getByText(/PO 4471/)).toBeTruthy();
    expect(screen.queryByText(/Net 30/)).toBeNull();
  });

  it("adds no terms segment at all when there is nothing to say", async () => {
    // The strip itself always states the invoice date now (a document of record has one), so what
    // is under test is that NO Net/due/PO segment is invented alongside it.
    getPublicInvoiceMock.mockResolvedValue(view({ termsDays: 0, dueAt: null, poNumber: null }));
    await renderPage();
    expect(screen.queryByText(/Net/)).toBeNull();
    expect(screen.queryByText(/PO /)).toBeNull();
    expect(screen.queryByText(/due /)).toBeNull();
  });
});

describe("PublicInvoicePage — the paid state is a receipt, not just a statement", () => {
  it("states the DATE, AMOUNT and METHOD of each payment received", async () => {
    // A page that says "Paid −$100.00" but cannot say when, how much, or by what means is a
    // statement. These three facts are what make it something the customer can keep.
    getPublicInvoiceMock.mockResolvedValue(
      view({
        status: "paid",
        amountPaidCents: 100_00,
        balanceDueCents: 0,
        payments: [
          { amountCents: 100_00, method: "cash", receivedAt: new Date("2026-08-05T18:00:00.000Z") },
        ],
      }),
    );
    await renderPage();
    expect(screen.getByText("Payments received")).toBeTruthy();
    expect(screen.getByText(/Aug 5 · Cash/)).toBeTruthy();
    expect(screen.getByText("Paid — thank you!")).toBeTruthy();
  });

  it("lists a part-payment too, so a partly-settled bill shows what already landed", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({
        status: "partial",
        amountPaidCents: 40_00,
        balanceDueCents: 60_00,
        payments: [
          { amountCents: 40_00, method: "check", receivedAt: new Date("2026-08-05T18:00:00.000Z") },
        ],
      }),
    );
    await renderPage();
    expect(screen.getByText(/Aug 5 · Check/)).toBeTruthy();
    expect(screen.getByText("Balance due")).toBeTruthy();
  });

  it("shows no payments block on an unpaid bill", async () => {
    getPublicInvoiceMock.mockResolvedValue(view());
    await renderPage();
    expect(screen.queryByText("Payments received")).toBeNull();
  });

  it("states NO balance on a canceled invoice", async () => {
    getPublicInvoiceMock.mockResolvedValue(view({ status: "void" }));
    await renderPage();
    expect(screen.queryByText("Balance due")).toBeNull();
    expect(screen.getByText(/This invoice was canceled/)).toBeTruthy();
  });
});

describe("PublicInvoicePage — a document of record, not a pay page", () => {
  it("prints who billed, who was billed, where and when", async () => {
    // The whole defect: this page carried the org NAME and nothing else. Not the customer's own
    // name, not an address, not a phone number, not a licence, not a date.
    getPublicInvoiceMock.mockResolvedValue(
      view({
        business: {
          address: "200 Ray St, Pleasanton, CA 94566",
          phone: "(925) 555-0100",
          email: "billing@rivera.test",
          site: "riveraplumbing.com",
          license: "C36-1029384",
        },
        customerName: "Dana Whitfield",
        serviceAddress: "18 Aspen Ct, Dublin, CA 94568",
        serviceAt: new Date("2026-08-03T16:20:00.000Z"),
      }),
    );
    await renderPage();

    expect(screen.getByText("200 Ray St, Pleasanton, CA 94566")).toBeTruthy();
    expect(screen.getByText("(925) 555-0100")).toBeTruthy();
    expect(screen.getByText("billing@rivera.test")).toBeTruthy();
    expect(screen.getByText("riveraplumbing.com")).toBeTruthy();
    expect(screen.getByText("Lic. C36-1029384")).toBeTruthy();

    expect(screen.getByText("Bill to")).toBeTruthy();
    expect(screen.getByText("Dana Whitfield")).toBeTruthy();
    expect(screen.getByText("Service address")).toBeTruthy();
    expect(screen.getByText("18 Aspen Ct, Dublin, CA 94568")).toBeTruthy();

    expect(screen.getByText(/Invoiced Aug 5, 2026/)).toBeTruthy();
    expect(screen.getByText(/Service Aug 3, 2026/)).toBeTruthy();
  });

  it("prints the shop's NAME once — from the branded header, never twice", async () => {
    getPublicInvoiceMock.mockResolvedValue(view({ customerName: "Dana Whitfield" }));
    await renderPage();
    expect(screen.getAllByText("Rivera Plumbing")).toHaveLength(1);
  });

  it("omits the whole row for anything the shop has not set", async () => {
    // A blank "Service address:" reads as a bug and a customer who finds one stops trusting the
    // numbers too. Nothing set means nothing printed.
    getPublicInvoiceMock.mockResolvedValue(view({ customerName: "Dana Whitfield" }));
    await renderPage();
    expect(screen.getByText("Bill to")).toBeTruthy();
    expect(screen.queryByText("Service address")).toBeNull();
    expect(screen.queryByText(/^Lic\./)).toBeNull();
  });

  it("states no service date rather than the invoice date wearing a Service label", async () => {
    // A bill handed to an insurer or a warranty desk must not carry a date that is not the date
    // the work happened.
    getPublicInvoiceMock.mockResolvedValue(view({ serviceAt: null }));
    await renderPage();
    expect(screen.getByText(/Invoiced Aug 5, 2026/)).toBeTruthy();
    expect(screen.queryByText(/Service Aug/)).toBeNull();
  });
});

describe("PublicInvoicePage — keepable, not just payable", () => {
  it("offers Print or save as PDF, and it actually prints", async () => {
    // No dead buttons: the browser's own dialog is where "Save as PDF" lives, so this one call
    // covers both verbs. Owen's ask was that the document be keepable.
    const print = vi.fn();
    vi.stubGlobal("print", print);
    getPublicInvoiceMock.mockResolvedValue(view());
    await renderPage();

    const button = screen.getByRole("button", { name: "Print or save as PDF" });
    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("marks the control itself and our own footer as .noprint", async () => {
    // The printed page must be the document alone. The rules that act on these live in
    // app/prototype.css under @media print, which jsdom does not apply — so what is asserted
    // here is the WIRING: that the two things which must not print carry the class that hides
    // them, and that the document body does not.
    getPublicInvoiceMock.mockResolvedValue(view());
    await renderPage();

    const button = screen.getByRole("button", { name: "Print or save as PDF" });
    expect(button.parentElement?.className).toContain("noprint");
    expect(screen.getByText("Powered by Mallet").className).toContain("noprint");
    expect(screen.getByText("Labor").closest(".noprint")).toBeNull();
  });
});
