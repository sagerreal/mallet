// @vitest-environment jsdom
/**
 * components/modals/cust-invoice-modal.preview-only.test.tsx
 *
 * Regression test for the scout's HIGH finding: this modal's one caller —
 * invoice-modal.tsx's "Preview as customer" button — opens it for a LOOK, not a
 * transaction. Its old pay() handler called recordPayment straight through, so an
 * office user tapping "Pay $X" under a screen announcing itself as a preview
 * recorded a REAL ledger payment with no Stripe charge and no cash in hand.
 *
 * Asserts the transacting path is gone (no recordPayment call reachable from this
 * component, not merely a hidden button) and that the surface says plainly it is a
 * preview. Mocking harness mirrors cust-invoice-modal.po-terms.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustInvoiceModalContent } from "./cust-invoice-modal";
import type { Invoice, Brand } from "@/lib/store/types";

const mockRecordPayment = vi.fn();
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
      // The shop's address/phone/licence — null here, so the identity block is absent and
      // these cases stay about what they were about.
      business: null,
      recordPayment: mockRecordPayment,
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
    lines: [{ d: "Hydro-jetting", q: 1, r: 185 }],
    total: 185,
    depPaid: 0,
    payments: [],
    status: "sent",
    age: 0,
    archived: false,
    origin: "db",
    ...over,
  }) as Invoice;

describe("CustInvoiceModalContent — preview only, never a real transaction", () => {
  beforeEach(() => {
    mockInvoices = [];
    mockRecordPayment.mockClear();
  });

  it("renders no Pay button — the transacting affordance is removed, not hidden", () => {
    mockInvoices = [inv({})];
    render(<CustInvoiceModalContent />);
    expect(screen.queryByRole("button", { name: /pay \$/i })).toBeNull();
    expect(screen.queryByText(/^Pay \$185/)).toBeNull();
  });

  it("says plainly that this is a preview and points back at the real invoice actions", () => {
    mockInvoices = [inv({})];
    render(<CustInvoiceModalContent />);
    expect(screen.getByText(/Preview only/i)).toBeTruthy();
    expect(screen.getByText(/doesn.t take real/i)).toBeTruthy();
  });

  it("never calls recordPayment, even after exercising every control the preview still renders", () => {
    mockInvoices = [inv({})];
    render(<CustInvoiceModalContent />);

    // Exercise every remaining interactive control in the pay block (method chips, amount
    // field) — none of them may reach recordPayment, because there is no longer a code path
    // from this component to the ledger at all.
    fireEvent.click(screen.getByText("Bank transfer"));
    fireEvent.click(screen.getByText("Card / Apple Pay"));
    fireEvent.change(screen.getByLabelText("Amount to pay"), { target: { value: "50" } });

    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("settled invoices keep showing no pay affordance either", () => {
    mockInvoices = [inv({ total: 185, payments: [{ amt: 185, when: "Just now", method: "cash" }] })];
    render(<CustInvoiceModalContent />);
    expect(screen.queryByRole("button", { name: /pay \$/i })).toBeNull();
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });
});
