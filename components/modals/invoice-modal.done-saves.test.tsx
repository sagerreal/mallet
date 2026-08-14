// @vitest-environment jsdom
/**
 * components/modals/invoice-modal.done-saves.test.tsx
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
const saveDraft = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });
let mockInvoices: Invoice[] = [];
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
      leads: [],
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


describe("InvoiceModalContent — Done saves a hand-made invoice", () => {
  beforeEach(() => {
    saveDraft.mockClear();
    closeModal.mockClear();
    saveDraft.mockResolvedValue({ ok: true });
    mockInvoices = [];
    queryState = { data: undefined, isError: false };
  });

  // A hand-made draft: no job, real customer, one line, nothing sent yet. priKind is "done"
  // because nothing has been sent and the balance is settled from the sheet's point of view.
  const handMade = (over: Partial<Invoice> = {}) =>
    inv({ origin: "manual", jobId: null, leadId: "lead-1", lines: [], total: 0, ...over } as Partial<Invoice>);

  it("saves before closing, instead of throwing the work away", async () => {
    mockInvoices = [handMade()];
    render(<InvoiceModalContent />);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledWith("inv-1"));
    await waitFor(() => expect(closeModal).toHaveBeenCalled());
  });

  it("stays open and says why when the save fails — never closes over lost work", async () => {
    saveDraft.mockResolvedValue({ ok: false, error: "add at least one line before saving" });
    mockInvoices = [handMade()];
    render(<InvoiceModalContent />);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(screen.getByText(/add at least one line/i)).toBeTruthy());
    expect(closeModal).not.toHaveBeenCalled();
  });

  it("shows no invoice number until the server has issued one", () => {
    // The sheet printed a real-looking "INV-810" beside a DRAFT pill, from a browser-side counter.
    mockInvoices = [handMade({ num: "" })];
    render(<InvoiceModalContent />);

    expect(screen.queryByText(/INV-8\d\d/)).toBeNull();
  });
});
