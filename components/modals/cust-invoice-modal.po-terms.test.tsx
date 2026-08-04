// @vitest-environment jsdom
/**
 * components/modals/cust-invoice-modal.po-terms.test.tsx
 *
 * Task 9: the customer-facing invoice preview renders the shared terms-line face
 * ("Net 30 · due Sep 2 · PO 4471") next to the invoice number. Mocking harness mirrors
 * invoice-modal.partial-gate.test.tsx, adapted for CustInvoiceModalContent's store reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustInvoiceModalContent } from "./cust-invoice-modal";
import type { Invoice, Brand } from "@/lib/store/types";

const noop = vi.fn();
let mockInvoices: Invoice[] = [];

const brand: Brand = {
  site: "riveraplumbing.com",
  name: "Rivera Plumbing",
  initials: "RP",
  color: "#1a5",
  tagline: "Licensed & insured",
};

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "cust-invoice", params: { invoiceId: "inv-1" } }),
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      invoices: mockInvoices,
      leads: [],
      jobs: [],
      brand,
      recordPayment: noop,
      adoptInvoice: noop,
      updateLead: noop,
    }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      invoicing: {
        get: { useQuery: () => ({ data: undefined, isError: false }) },
      },
    },
  },
}));

const inv = (over: Partial<Invoice>): Invoice =>
  ({
    id: "inv-1",
    num: "INV-810",
    jobId: null,
    leadId: "lead-1",
    cust: "Priya Novak",
    phone: "",
    title: "Hydro-jetting — main sewer",
    lines: [{ d: "Hydro-jetting", q: 1, r: 685 }],
    total: 685,
    depPaid: 0,
    payments: [],
    status: "sent",
    age: 0,
    archived: false,
    origin: "db",
    ...over,
  }) as Invoice;

describe("CustInvoiceModalContent — Net terms + PO on the face", () => {
  beforeEach(() => {
    mockInvoices = [];
  });

  it("renders the shared terms-line face next to the invoice number", () => {
    mockInvoices = [inv({ termsDays: 30, dueAt: "2026-09-02T18:00:00.000Z", poNumber: "4471" })];
    render(<CustInvoiceModalContent />);
    expect(screen.getByText("Invoice INV-810 · Net 30 · due Sep 2 · PO 4471")).toBeTruthy();
  });

  it("shows the invoice number alone when there is nothing to say", () => {
    mockInvoices = [inv({ termsDays: 0, dueAt: null, poNumber: undefined })];
    render(<CustInvoiceModalContent />);
    expect(screen.getByText("Invoice INV-810")).toBeTruthy();
  });
});
