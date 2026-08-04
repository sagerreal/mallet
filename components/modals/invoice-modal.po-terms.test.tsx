// @vitest-environment jsdom
/**
 * components/modals/invoice-modal.po-terms.test.tsx
 *
 * Task 9: the office sheet renders the shared terms-line face ("Net 30 · due Sep 2 · PO 4471")
 * and carries an in-flow PO-number editor (SheetRow accordion, matching "Record a payment"'s
 * grammar) that persists through updateInvoice → v1.invoicing.updateMetadata. Same mocking
 * harness as invoice-modal.partial-gate.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InvoiceModalContent } from "./invoice-modal";
import type { Invoice } from "@/lib/store/types";

const noop = vi.fn();
const updateInvoice = vi.fn();
let mockInvoices: Invoice[] = [];

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "invoice", params: { invoiceId: "inv-1" } }),
  useCloseModal: () => noop,
  usePushModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      invoices: mockInvoices,
      adoptInvoice: noop,
      leads: [],
      services: [],
      jobs: [],
      updateInvoice,
      archiveInvoice: noop,
      setInvoiceLines: noop,
      recordPayment: noop,
      sendInvoice: noop,
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
    num: "INV-1847",
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

describe("InvoiceModalContent — Net terms + PO on the face", () => {
  beforeEach(() => {
    updateInvoice.mockClear();
    mockInvoices = [];
  });

  it("renders the shared terms-line face when terms/due/PO are set", () => {
    mockInvoices = [
      inv({ termsDays: 30, dueAt: "2026-09-02T18:00:00.000Z", poNumber: "4471" }),
    ];
    render(<InvoiceModalContent />);
    expect(screen.getByText("Net 30 · due Sep 2 · PO 4471")).toBeTruthy();
  });

  it("renders nothing extra in the meta line when there's nothing to say", () => {
    mockInvoices = [inv({ status: "draft", termsDays: 0, dueAt: null, poNumber: undefined })];
    const { container } = render(<InvoiceModalContent />);
    // Scoped to .sheet-meta so the PO-editor row's own "PO number" label (unrelated — it's the
    // affordance, not the face line) can never collide with this assertion.
    const meta = container.querySelector(".sheet-meta");
    expect(meta?.textContent ?? "").not.toMatch(/Net \d/);
    expect(meta?.textContent ?? "").not.toMatch(/PO \S/);
  });

  it("the PO row shows 'Add' when unset, and the real value once set", () => {
    mockInvoices = [inv({ poNumber: undefined })];
    render(<InvoiceModalContent />);
    expect(screen.getByRole("button", { name: /PO number.*Add/s })).toBeTruthy();
  });

  it("shows the current PO value as the row's summary", () => {
    mockInvoices = [inv({ poNumber: "4471" })];
    render(<InvoiceModalContent />);
    expect(screen.getByRole("button", { name: /PO number.*4471/s })).toBeTruthy();
  });

  it("editing the PO field calls updateInvoice with the typed value", () => {
    mockInvoices = [inv({ poNumber: undefined })];
    render(<InvoiceModalContent />);
    fireEvent.click(screen.getByRole("button", { name: /PO number/ }));
    const input = screen.getByLabelText("PO number") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "9981" } });
    expect(updateInvoice).toHaveBeenCalledWith("inv-1", { poNumber: "9981" });
  });

  it("hides the PO editor once the invoice is PAID (frozen, matches editMetadata's gate)", () => {
    mockInvoices = [inv({ status: "paid", poNumber: "4471" })];
    render(<InvoiceModalContent />);
    expect(screen.queryByRole("button", { name: /PO number/ })).toBeNull();
    // The face line still shows the PO as plain text — it's a closed record now, not an editor.
    expect(screen.getByText("PO 4471")).toBeTruthy();
  });

  it("hides the PO editor once the invoice is VOID", () => {
    mockInvoices = [inv({ status: "void", poNumber: "4471" })];
    render(<InvoiceModalContent />);
    expect(screen.queryByRole("button", { name: /PO number/ })).toBeNull();
  });
});
