/**
 * features/board/use-work-board.test.tsx
 * The board's COMPOSITION, tested where it lives: `assembleBoard` is the whole
 * hook minus the queries, so everything that decides what an owner sees — column
 * order, the needs-you figure, which rows are excluded, which header figures are
 * the book's and which are the page's — is asserted here without React Query.
 *
 * Fixtures are shaped from the real store types the hook maps its DTO rows into,
 * never from invented fields.
 */

import { describe, expect, it } from "vitest";
import { assembleBoard, boardLoadState, type WorkBoardInputs } from "./use-work-board";
import type { OkItem } from "@/features/home/derive";
import type { RailRow } from "@/features/quotes/derive";
import type { GettingRow } from "@/features/pipeline/working";
import type { Estimate, Invoice, Job, Lead, Visit } from "@/lib/store/types";

// ---- fixtures ---------------------------------------------------------------

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "l1", name: "Maria Ortiz", phone: "555-0100", source: "web", stage: "New customer",
  age: 2, job: "Water heater leaking", last: "", ...over,
});

const estimate = (over: Partial<Estimate> = {}): Estimate => ({
  id: "e1", num: "EST-1001", leadId: "l1", title: "Water heater replacement",
  status: "sent", age: 4, viewed: true, fu: { on: false, stage: 0 }, lines: [], ...over,
});

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1", date: "2026-08-10", techId: "t1", start: 8, dur: 2, status: "scheduled", ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", leadId: "l1", svc: "plumbing", kind: "work", origin: "db",
  title: "Water heater replacement", addr: "12 Elm St", phone: "555-0100",
  status: "scheduled", archived: false, lines: [{ d: "Install", q: 1, r: 1800 }],
  addons: [], photos: [], notes: "", acts: [], visits: [visit()], ...over,
});

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: "i1", num: "INV-2001", jobId: "j1", leadId: "l1", cust: "Maria Ortiz",
  phone: "555-0100", title: "Water heater replacement", lines: [], total: 1325,
  depPaid: 0, payments: [], status: "sent", age: 30, archived: false, ...over,
});

/** Past the date the customer agreed to — the "over" band of invStatusKey, clock pinned 2026-07-01. */
const overdueInvoice = invoice({ dueAt: "2026-06-01T12:00:00" });

const railRow = (over: Partial<RailRow> = {}): RailRow => ({
  est: estimate(), customerName: "Maria Ortiz", lead: null, total: 2890,
  quietDays: 3, cool: 0.64, rings: 1, live: false, stamp: "Quiet 3 days", ...over,
});

const gettingRow = (over: Partial<GettingRow> = {}): GettingRow => ({
  lead: lead({ id: "l3", name: "Ray Nunez" }), est: null, kind: "scoped",
  stamp: "scoped today", verb: "quote it ›", scopeVisitJobId: "j9", ...over,
});

/** The two OkItem shapes the queue produces — only the keyed record matters to the board. */
const quoteOk = { key: "okq-e1", kind: "quote-viewed", estimate: { id: "e1" }, value: 2890 } as OkItem;
const invoiceOk = { key: "oki-i1", kind: "invoice-overdue", invoice: { id: "i1" }, value: 1325 } as OkItem;

const inputs = (over: Partial<WorkBoardInputs> = {}): WorkBoardInputs => ({
  requests: [],
  getting: [],
  out: [],
  jobs: [],
  needsInvoiceJobs: [],
  invoices: [],
  jobCustomerNames: new Map(),
  invCustomerNames: new Map(),
  oks: [],
  server: {},
  truncated: { requests: false, quoting: false, jobs: false, billing: false },
  isFetched: true,
  isError: false,
  ...over,
});

/**
 * One loaded board: 2 intake leads (one priced at $450), 1 scoped deal, 1 sent quote with a
 * prepared reminder ($2,890), 2 work jobs (one unscheduled at $1,800, one already booked) and
 * 1 overdue bill with a prepared reminder ($1,325).
 */
const loadedBoard = (): WorkBoardInputs =>
  inputs({
    requests: [lead({ value: 0 }), lead({ id: "l2", name: "Dana Whitfield", value: 450 })],
    getting: [gettingRow()],
    out: [railRow()],
    jobs: [
      job({ id: "j1", visits: [] }),
      job({ id: "j2", lines: [{ d: "Service call", q: 1, r: 900 }] }),
    ],
    invoices: [overdueInvoice],
    jobCustomerNames: new Map([["j1", "Maria Ortiz"], ["j2", "Dana Whitfield"]]),
    oks: [quoteOk, invoiceOk],
  });

// ---- assembleBoard ------------------------------------------------------------

describe("assembleBoard", () => {
  it("assembles four columns in fixed order with needs-you sums", () => {
    const board = assembleBoard(loadedBoard());
    expect(board.columns.map((c) => c.id)).toEqual(["requests", "quoting", "jobs", "billing"]);
    // 450 (priced lead) + 2,890 (quote out) + 1,800 (job to schedule) + 1,325 (overdue bill).
    expect(board.needsYou).toEqual({ count: 6, valueDollars: 6465, textsReady: 2 });
  });

  it("renders all four columns even when nothing loaded", () => {
    const board = assembleBoard(inputs());
    expect(board.columns.map((c) => c.id)).toEqual(["requests", "quoting", "jobs", "billing"]);
    expect(board.columns.map((c) => c.title)).toEqual([
      "New requests", "Estimates & quotes", "Jobs", "Billing",
    ]);
    expect(board.columns.every((c) => c.items.length === 0 && c.count === 0)).toBe(true);
    expect(board.needsYou).toEqual({ count: 0, valueDollars: 0, textsReady: 0 });
  });

  it("keeps estimate-kind jobs out of the jobs column — they ride the quoting column", () => {
    const board = assembleBoard(
      inputs({ jobs: [job({ id: "j1" }), job({ id: "j5", kind: "estimate", title: "Walkthrough" })] }),
    );
    expect(board.columns[2].items.map((i) => i.refId)).toEqual(["j1"]);
  });

  it("names jobs and bills from the list-DTO seams the store mappers drop", () => {
    const board = assembleBoard(
      inputs({
        jobs: [job()],
        // The list hydrator writes cust: "" — the seam is the only name this row has.
        invoices: [invoice({ id: "i2", cust: "", status: "draft" })],
        jobCustomerNames: new Map([["j1", "Maria Ortiz"]]),
        invCustomerNames: new Map([["i2", "Dana Whitfield"]]),
      }),
    );
    expect(board.columns[2].items[0]?.name).toBe("Maria Ortiz");
    expect(board.columns[3].items[0]?.name).toBe("Dana Whitfield");
  });

  it("attaches a prepared text to the record it is about", () => {
    const board = assembleBoard(loadedBoard());
    const quoteCard = board.columns[1].items.find((i) => i.refId === "e1");
    const billCard = board.columns[3].items.find((i) => i.refId === "i1");
    expect(quoteCard).toMatchObject({ stateLabel: "Reminder due", ok: quoteOk });
    expect(billCard).toMatchObject({ stateLabel: "Overdue", ok: invoiceOk });
  });

  it("shows a bill returned by two views once", () => {
    // The four invoice views are mutually exclusive server-side, but they are four separate reads:
    // a bill that crosses its due date between two of them lands in both pages at once.
    const board = assembleBoard(inputs({ invoices: [overdueInvoice, invoice({ dueAt: null })] }));
    expect(board.columns[3].items.map((i) => i.key)).toEqual(["bi-i1"]);
  });

  it("prefers the server's intake count over the loaded page", () => {
    const board = assembleBoard(inputs({ requests: [lead()], server: { requestCount: 42 } }));
    expect(board.columns[0].count).toBe(42);
    expect(board.columns[0].items).toHaveLength(1);
  });

  it("states the whole book in the billing header while no draft is on the board", () => {
    const board = assembleBoard(
      inputs({
        needsInvoiceJobs: [job({ status: "done", visits: [visit({ date: "2026-06-28", status: "done" })] })],
        invoices: [invoice()],
        server: {
          needsInvoiceCount: 7, needsInvoiceCents: 250_000,
          openInvoiceCount: 12, openInvoiceCents: 890_000,
        },
      }),
    );
    expect(board.columns[3].count).toBe(19);
    expect(board.columns[3].valueDollars).toBe(11_400);
  });

  it("states its own cards in the billing header once a draft is on it", () => {
    // totals() excludes drafts by construction, so the book-wide figures no longer describe this
    // column — a header that silently omits a card underneath it is worse than a page-scoped one.
    const board = assembleBoard(
      inputs({
        invoices: [invoice({ id: "d1", status: "draft" }), invoice()],
        server: {
          needsInvoiceCount: 7, needsInvoiceCents: 250_000,
          openInvoiceCount: 12, openInvoiceCents: 890_000,
        },
      }),
    );
    expect(board.columns[3].count).toBe(2);
    expect(board.columns[3].valueDollars).toBe(2650);
  });

  it("carries each column's truncation flag through", () => {
    const board = assembleBoard(
      inputs({ truncated: { requests: true, quoting: false, jobs: true, billing: false } }),
    );
    expect(board.columns.map((c) => c.truncated)).toEqual([true, false, true, false]);
  });

  it("passes the load state through untouched", () => {
    expect(assembleBoard(inputs({ isFetched: false, isError: true }))).toMatchObject({
      isFetched: false,
      isError: true,
    });
  });
});

// ---- boardLoadState -----------------------------------------------------------

describe("boardLoadState", () => {
  const source = (over: Partial<{ isFetched: boolean; isError: boolean; hasData: boolean }> = {}) => ({
    isFetched: true, isError: false, hasData: true, ...over,
  });

  it("is fetched only when every source is", () => {
    expect(boardLoadState([source(), source()]).isFetched).toBe(true);
    expect(boardLoadState([source(), source({ isFetched: false })]).isFetched).toBe(false);
  });

  it("errors only when a failed source has nothing usable in hand", () => {
    expect(boardLoadState([source({ isError: true, hasData: true })]).isError).toBe(false);
    expect(boardLoadState([source({ isError: true, hasData: false })]).isError).toBe(true);
  });

  it("an empty board with no sources is fetched and unbroken", () => {
    expect(boardLoadState([])).toEqual({ isFetched: true, isError: false });
  });
});
