// @vitest-environment jsdom
/**
 * components/modals/invoice-modal.partial-gate.test.tsx
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
import { render, screen } from "@testing-library/react";
import { InvoiceModalContent } from "./invoice-modal";
import type { Invoice } from "@/lib/store/types";

const noop = vi.fn();
const adoptInvoice = vi.fn();
let mockInvoices: Invoice[] = [];
let queryState: { data: unknown; isError: boolean } = { data: undefined, isError: false };
let lastQueryOpts: { enabled?: boolean } | undefined;

vi.mock("@/lib/store/app-store", () => ({
  // The record trail navigates with this. A stub: these tests assert the sheet's own body.
  // (useCloseModal is already mocked below — a second key here is a duplicate tsc rejects.)
  useOpenModal: () => vi.fn(),
  useActiveModal: () => ({ id: "invoice", params: { invoiceId: "inv-1" } }),
  useCloseModal: () => noop,
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

describe("InvoiceModalContent — the partial-row gate", () => {
  beforeEach(() => {
    adoptInvoice.mockClear();
    mockInvoices = [];
    queryState = { data: undefined, isError: false };
    lastQueryOpts = undefined;
  });

  it("a partial draft renders Loading — never the editor its summary fields suggest", () => {
    mockInvoices = [inv({ partial: true })];
    render(<InvoiceModalContent />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    // The branch was never guessed: no Bill-to editor, no read-only bill.
    expect(screen.queryByText("Bill to")).toBeNull();
    // And the full record is being fetched even though the row exists.
    expect(lastQueryOpts?.enabled).toBe(true);
  });

  it("does not fetch a store-local draft the server has never seen", () => {
    // A hand-made draft carries a client-authored id and no DB row, so v1.invoicing.get 404s.
    // The sheet fetched anyway; React Query cached that 404, and after the invoice was sent the
    // now-partial row re-read the SAME cached error and showed "Couldn't load this invoice" —
    // for an invoice that had, in fact, gone out.
    mockInvoices = [inv({ origin: "manual", lines: [{ d: "Visit fee", q: 1, r: 89 }] })];
    render(<InvoiceModalContent />);
    expect(lastQueryOpts?.enabled).toBe(false);
  });

  it("adopts the full record over a partial row when the fetch lands", () => {
    mockInvoices = [inv({ partial: true })];
    queryState = {
      data: {
        id: "inv-1",
        num: "INV-1847",
        sourceJobId: "job-9",
        leadId: "lead-1",
        customerName: "Priya Novak",
        title: "Hydro-jetting — main sewer",
        status: "draft",
        total: { cents: 68500, currency: "USD" },
        due: { cents: 68500, currency: "USD" },
        tax: { cents: 0, currency: "USD" },
        discBps: 0,
        discount: { cents: 0, currency: "USD" },
        depositPaid: { cents: 0, currency: "USD" },
        payments: [],
        lines: [{ description: "Hydro-jetting", quantity: 1, rate: { cents: 68500, currency: "USD" }, cost: { cents: 0, currency: "USD" } }],
        createdAt: new Date().toISOString(),
        dueAt: null,
      },
      isError: false,
    };
    render(<InvoiceModalContent />);
    expect(adoptInvoice).toHaveBeenCalledTimes(1);
    const adopted = adoptInvoice.mock.calls[0]?.[0] as Invoice;
    expect(adopted.jobId).toBe("job-9");
    expect(adopted.partial).toBeUndefined();
  });

  it("a full job-born draft renders read-only with the From-job row — not the editor", () => {
    mockInvoices = [inv({ jobId: "job-9", lines: [{ d: "Hydro-jetting", q: 1, r: 685 }] })];
    render(<InvoiceModalContent />);
    expect(screen.getByText("From job")).toBeTruthy();
    expect(screen.queryByText("Bill to")).toBeNull();
  });

  it("a full job-born draft with nothing billed says so and points at the job", () => {
    mockInvoices = [inv({ jobId: "job-9", total: 0 })];
    render(<InvoiceModalContent />);
    expect(screen.getByText("No bill yet")).toBeTruthy();
    expect(screen.getByText("Price the job and the bill lands here.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the job" })).toBeTruthy();
  });

  it("a full hand-made draft still opens the editor", () => {
    mockInvoices = [inv({})];
    render(<InvoiceModalContent />);
    expect(screen.getByText("Bill to")).toBeTruthy();
  });

  it("names the failure when the fetch for a partial row errors", () => {
    mockInvoices = [inv({ partial: true })];
    queryState = { data: undefined, isError: true };
    render(<InvoiceModalContent />);
    expect(screen.getByText("Couldn't load this invoice. Close and try again.")).toBeTruthy();
  });
});
