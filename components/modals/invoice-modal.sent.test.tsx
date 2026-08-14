// @vitest-environment jsdom
/**
 * components/modals/invoice-modal.sent.test.tsx
 *
 * The Money ledger and hydrator fill the store with SUMMARY invoice rows —
 * `partial: true`, no lines, no jobId. The sheet decides editor-vs-read-only
 * from exactly those fields, so rendering a partial row is how a job's $685
 * draft opened the hand-made-draft editor with an empty Bill-to and "No lines
 * yet" (Owen hit this on INV-1847). Guards the contract: a partial row renders
 * a quiet Loading line (never a guessed branch), the full record is fetched on
 * every open, adopted over the summary, and only then does the sheet commit to
 * a branch — including the "From job" provenance row for job-born invoices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InvoiceModalContent } from "./invoice-modal";
import type { Invoice } from "@/lib/store/types";

const noop = vi.fn();
const closeModal = vi.fn();
const adoptInvoice = vi.fn();
const sendReminder = vi.fn(async (_input?: unknown) => ({}) as unknown);
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      notifications: { sendInvoiceReminder: { mutate: (i: unknown) => sendReminder(i) } },
      invoicing: { createPayment: { mutate: async () => ({ url: "https://checkout.test" }) } },
    },
  },
}));
const saveDraft = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
let mockInvoices: Invoice[] = [];
let mockLeads: unknown[] = [];
let queryState: { data: unknown; isError: boolean } = { data: undefined, isError: false };
let lastQueryOpts: { enabled?: boolean } | undefined;

vi.mock("@/lib/store/app-store", () => ({
  // The record trail navigates with this. A stub: these tests assert the sheet's own body.
  // (useCloseModal is already mocked below — a second key here is a duplicate tsc rejects.)
  useOpenModal: () => vi.fn(),
  useActiveModal: () => ({ id: "invoice", params: { invoiceId: "inv-1" } }),
  useCloseModal: () => closeModal,
  usePushModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      invoices: mockInvoices,
      adoptInvoice,
      leads: mockLeads,
      services: [],
      jobs: [],
      updateInvoice: noop,
      archiveInvoice: noop,
      setInvoiceLines: noop,
      recordPayment: noop,
      sendInvoice: noop,
      saveDraft,
    }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      // The sheet header's record trail. Undefined data renders nothing, which is what these tests
      // want — they are about the sheet's own body, not the chain.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      invoicing: {
        get: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
            lastQueryOpts = opts;
            return queryState;
          },
        },
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
    lines: [],
    total: 685,
    depPaid: 0,
    payments: [],
    status: "draft",
    age: 0,
    archived: false,
    origin: "db",
    ...over,
  }) as Invoice;



describe("InvoiceModalContent — a SENT invoice", () => {
  beforeEach(() => {
    saveDraft.mockClear();
    closeModal.mockClear();
    sendReminder.mockClear();
    sendReminder.mockResolvedValue({});
    mockLeads = [];
    queryState = { data: undefined, isError: false };
    // Sent, still owed — the state that shows "Charge a card".
    mockInvoices = [
      inv({ status: "sent", total: 200, depPaid: 0, payments: [], leadId: "lead-1" } as Partial<Invoice>),
    ];
  });

  it("offers a resend — a sent invoice was a dead end for re-delivery", async () => {
    // The Send button is swapped for "Charge a card" the moment an invoice is sent, and no resend
    // existed anywhere. A quote can be resent; an invoice could not, so a customer who lost the
    // text had to be chased by hand.
    render(<InvoiceModalContent />);
    fireEvent.click(screen.getByText("Resend invoice")); // open the row

    fireEvent.click(await screen.findByRole("button", { name: /send it again/i }));

    await waitFor(() => expect(sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "inv-1" }),
    ));
  });

  it("says the resend went out, rather than leaving the office guessing", async () => {
    render(<InvoiceModalContent />);
    fireEvent.click(screen.getByText("Resend invoice"));
    fireEvent.click(await screen.findByRole("button", { name: /send it again/i }));

    await waitFor(() => expect(screen.getByText(/sent to/i)).toBeTruthy());
  });

  it("surfaces a refused resend instead of silently claiming success", async () => {
    sendReminder.mockRejectedValue(new Error("no phone or email on file for this customer"));
    render(<InvoiceModalContent />);
    fireEvent.click(screen.getByText("Resend invoice")); // open the row

    fireEvent.click(await screen.findByRole("button", { name: /send it again/i }));

    await waitFor(() => expect(screen.getByText(/no phone or email/i)).toBeTruthy());
  });

  it("names the card on file, so 'Charge a card' is not a mystery", () => {
    // The sheet never surfaced whether a card was saved. The office saw "Charge a card" with no
    // way to know whether that meant a saved card or asking the customer for one.
    mockLeads = [{ id: "lead-1", name: "Ada", card: { brand: "Visa", last4: "4242", via: "checkout" } }];
    render(<InvoiceModalContent />);

    expect(screen.getByText(/Visa/)).toBeTruthy();
    expect(screen.getByText(/4242/)).toBeTruthy();
  });

  it("says so when there is NO card on file", () => {
    mockLeads = [{ id: "lead-1", name: "Ada" }];
    render(<InvoiceModalContent />);

    expect(screen.getByText(/no card on file/i)).toBeTruthy();
  });
});
