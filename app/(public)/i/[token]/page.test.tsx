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
    lines: [{ description: "Labor", quantity: 1, rateCents: 100_00 }],
    totalCents: 100_00,
    taxCents: 0,
    depositPaidCents: 0,
    amountPaidCents: 0,
    balanceDueCents: 100_00,
    status: "sent",
    termsDays: 7,
    dueAt: null,
    poNumber: null,
    orgName: "Rivera Plumbing",
    chargesEnabled: false,
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
    expect(screen.getByText("Net 30 · due Sep 2 · PO 4471")).toBeTruthy();
  });

  it("on-receipt (termsDays 0) shows the due date without 'Net 0'", async () => {
    getPublicInvoiceMock.mockResolvedValue(
      view({ termsDays: 0, dueAt: new Date("2026-09-02T18:00:00.000Z"), poNumber: null }),
    );
    await renderPage();
    expect(screen.getByText("due Sep 2")).toBeTruthy();
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
    expect(screen.getByText("PO 4471")).toBeTruthy();
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
    expect(screen.getByText("PO 4471")).toBeTruthy();
    expect(screen.queryByText(/Net 30/)).toBeNull();
  });

  it("renders no meta line at all when there is nothing to say", async () => {
    getPublicInvoiceMock.mockResolvedValue(view({ termsDays: 0, dueAt: null, poNumber: null }));
    await renderPage();
    expect(screen.queryByText(/Net/)).toBeNull();
    expect(screen.queryByText(/PO /)).toBeNull();
    expect(screen.queryByText(/due /)).toBeNull();
  });
});
