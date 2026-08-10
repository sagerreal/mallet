// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The morning queue, from the database.
 *
 * TWO BUGS it replaces:
 *
 * 1. "Viewed" was read off the quote's STATUS — sent counted as seen — so the queue drafted
 *    "Saw you had a look at the quote" to customers who may never have opened it. It now keys on
 *    first_viewed_at, stamped when the public link is actually loaded, and the server only returns
 *    quotes that have one.
 *
 * 2. Overdue invoices were meant to be here and never appeared: the queue derived from the
 *    browser's loaded page, so on a shop with 239 open invoices not one overdue bill reached it.
 */

let quoteRows: unknown[] | undefined;
let invoiceRows: unknown[] | undefined;
let dismissed: string[] = [];

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      quoting: { followUps: { useQuery: () => ({ data: quoteRows, isFetched: true, isError: false }) } },
      invoicing: {
        list: { useQuery: () => ({ data: invoiceRows ? { items: invoiceRows } : undefined, isFetched: true, isError: false }) },
      },
    },
  },
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { dismissedAttention: string[]; leads: unknown[] }) => unknown) =>
    sel({ dismissedAttention: dismissed, leads: [] }),
}));

import { useOkQueue } from "./use-ok-queue";

const quote = (over: Record<string, unknown> = {}) => ({
  id: "est-1", num: "EST-1", leadId: "lead-1", customerName: "Luis Ibarra",
  customerPhone: "+19255550111",
  title: "Repipe", total: { cents: 117500, currency: "USD" },
  sentAt: new Date(Date.now() - 13 * 86_400_000).toISOString(),
  firstViewedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", num: "INV-1", leadId: "lead-2", customerName: "Ruth Ferraro",
  customerPhone: "+19255550122",
  title: "Sewer camera", status: "sent",
  total: { cents: 64000, currency: "USD" },
  due: { cents: 24000, currency: "USD" },
  dueAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  ...over,
});

describe("the OK queue", () => {
  beforeEach(() => {
    quoteRows = [];
    invoiceRows = [];
    dismissed = [];
  });

  it("carries BOTH kinds — the overdue invoices were the missing half", () => {
    quoteRows = [quote()];
    invoiceRows = [invoice()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items.map((i) => i.kind)).toEqual(["quote-viewed", "invoice-overdue"]);
  });

  it("counts the money the queue is actually holding", () => {
    quoteRows = [quote()];
    invoiceRows = [invoice()];
    const { result } = renderHook(() => useOkQueue());
    // $1,175 of quote + $240 still owed — the BALANCE, not the invoice total.
    expect(result.current.value).toBe(1175 + 240);
  });

  it("exposes the overdue subset for the bulk action", () => {
    quoteRows = [quote()];
    invoiceRows = [invoice(), invoice({ id: "inv-2", leadId: "lead-3" })];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.overdue).toHaveLength(2);
  });

  it("says how long the quote has been sitting, from when it went out", () => {
    quoteRows = [quote()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items[0]!.situation).toContain("13d since it went out");
  });

  it("says how late the invoice is, from its due date", () => {
    invoiceRows = [invoice()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items[0]!.situation).toContain("30d past due");
  });

  it("drops what has been dismissed — this is what drains the figure", () => {
    quoteRows = [quote()];
    invoiceRows = [invoice()];
    dismissed = ["okq-est-1"];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items).toHaveLength(1);
    expect(result.current.value).toBe(240);
  });

  // The draft names the bill and the amount off item.invoice. Without it the reminder read
  // "invoice () is still open" — and the Send button was right there.
  it("attaches the invoice so the reminder can name it", () => {
    invoiceRows = [invoice()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items[0]!.invoice?.num).toBe("INV-1");
  });

  it("attaches the quote so the follow-up can state its value", () => {
    quoteRows = [quote()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items[0]!.estimate?.num).toBe("EST-1");
  });

  // The phone comes from the SERVER. The stub used to hard-code "", so a customer outside the
  // loaded page showed "No phone number yet" and asked for a number the shop already had.
  it("carries the customer's phone even when the customer is not loaded", () => {
    invoiceRows = [invoice()];
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items[0]!.lead.phone).toBe("+19255550122");
  });

  it("is empty rather than guessing while the reads are in flight", () => {
    quoteRows = undefined;
    invoiceRows = undefined;
    const { result } = renderHook(() => useOkQueue());
    expect(result.current.items).toHaveLength(0);
    expect(result.current.value).toBe(0);
  });

  // An EMPTY queue is an answer, not a missing one. A caller cannot infer this from items.length:
  // a shop that has dismissed everything would read as "no data" and one failed refetch would then
  // look like a broken screen.
  it("reports data in hand once both reads have answered, empty or not", () => {
    quoteRows = [];
    invoiceRows = [];
    expect(renderHook(() => useOkQueue()).result.current.hasData).toBe(true);
  });

  it("reports no data while either read is still in flight", () => {
    quoteRows = [quote()];
    invoiceRows = undefined;
    expect(renderHook(() => useOkQueue()).result.current.hasData).toBe(false);
  });
});
