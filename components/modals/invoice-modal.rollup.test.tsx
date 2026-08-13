// @vitest-environment jsdom
/**
 * components/modals/invoice-modal.rollup.test.tsx
 *
 * PLACEHOLDER — replaced below.
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


describe("InvoiceModalContent — the rollup adds up", () => {
  beforeEach(() => {
    adoptInvoice.mockClear();
    mockInvoices = [];
    queryState = { data: undefined, isError: false };
    lastQueryOpts = undefined;
  });

  // $1000 of lines, 10% off, 8.75% tax on the discounted base:
  //   subtotal 1000 · discount 100 · net 900 · tax 78.75 · total 978.75
  const discounted = () =>
    inv({
      lines: [{ d: "Hydro-jetting", q: 1, r: 1000 }],
      total: 978.75,
      tax: 78.75,
      disc: 100,
      pricing: { disc: 10, tax: 8.75 },
    } as Partial<Invoice>);

  it("shows the gross line sum as Subtotal, not the post-discount net", () => {
    // Subtotal was rendered as (total - tax), which is the NET. With a discount row printed
    // beneath it the column read 900 - 100 + 78.75 and did not reach the 978.75 stated as Total.
    mockInvoices = [discounted()];
    render(<InvoiceModalContent />);

    expect(screen.getByText("$1,000")).toBeTruthy();
  });

  it("prints the discount amount that was actually recorded", () => {
    mockInvoices = [discounted()];
    render(<InvoiceModalContent />);

    expect(screen.getByText("−$100")).toBeTruthy();
  });

  it("the four rows reconcile: subtotal − discount + tax = total", () => {
    mockInvoices = [discounted()];
    render(<InvoiceModalContent />);

    const num = (t: string) => Number(t.replace(/[^0-9.]/g, ""));
    const subtotal = num(screen.getByText("$1,000").textContent ?? "");
    const discount = num(screen.getByText("−$100").textContent ?? "");
    const tax = num(screen.getByText("$79").textContent ?? "");
    const total = num(screen.getByText("$979").textContent ?? "");

    expect(subtotal - discount + tax).toBe(total);
  });

  it("shows no discount row on a bill that has none", () => {
    mockInvoices = [inv({ lines: [{ d: "Work", q: 1, r: 685 }], total: 685, tax: 0, disc: 0 })];
    render(<InvoiceModalContent />);

    expect(screen.queryByText(/^Discount \d/)).toBeNull();
  });
});
