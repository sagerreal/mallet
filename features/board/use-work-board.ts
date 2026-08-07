"use client";

/**
 * features/board/use-work-board.ts
 * EVERY OPEN PIECE OF WORK, IN ONE READ — the board's only data source.
 *
 * Composition, not a new endpoint. Each column is already answered by a worklist the app ships:
 * the Pipeline's server-selected quoting/out columns (useRailColumns), the morning queue's
 * prepared reminders (useOkQueue), the customers intake view, the jobs list and its scoped
 * needs-invoice view, and the invoice ledger's status bands. This hook fetches those, maps the
 * rows through the SAME store mappers every other screen uses, and hands them to the pure
 * derivations in derive.ts. Nothing here re-decides membership: the database owns which rows are
 * in a column, and derive.ts owns how a card reads.
 *
 * WHY THE QUERY ARGS ARE COPIED, NOT INVENTED. Every read below repeats an existing caller's key
 * and options verbatim (the /pipeline page's intake read, the view-count endpoints, useOkQueue's
 * overdue read), so React Query serves both callers from ONE fetch. A near-miss variant — a
 * different limit, a different sort — is not a smaller change than a new endpoint; it is a second
 * copy of the same rows in the cache, refetching on its own schedule.
 *
 * `today` is the CLIENT's local date: there is no org timezone column, and jobs.list rejects a
 * date-relative view without one (modules/jobs/infra/job-views.ts).
 *
 * The React wrapper holds queries and one memo. Every rule — column order, what a header states,
 * which rows are excluded, which page is truncated — lives in an exported pure function below and
 * is unit-tested there.
 */

import { useMemo } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { localToday } from "@/features/jobs/use-jobs-query";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { toStoreJob } from "@/features/jobs/jobs-hydrator";
import { dtoInvoiceSummaryToStore } from "@/lib/store/dto-mapper";
import { invDue, invStatusKey } from "@/features/money/money-derive";
import { useRailColumns } from "@/features/pipeline/use-rail-columns";
import { useOkQueue } from "@/features/home/use-ok-queue";
import { billingItems, columnOf, jobItem, needsYouOf, quotingItems, requestItem } from "./derive";
import type { OkItem } from "@/features/home/derive";
import type { RailRow } from "@/features/quotes/derive";
import type { GettingRow } from "@/features/pipeline/working";
import type { Invoice, Job, Lead } from "@/lib/store/types";
import type { BoardColumn, BoardColumnId, WorkBoardData } from "./types";

/**
 * Worklist caps. Past these a column is a backlog rather than a day's work, and the header says so
 * (`truncated`) instead of quietly showing a slice — the same contract useRailColumns keeps.
 */
const REQUEST_CAP = 100;
const JOB_CAP = 100;
/** Bills and finished-unbilled work: the queue cap useOkQueue already uses for the same rows. */
const BILL_CAP = 50;

/** Owner-facing column names. One place, so the header and any label read the same words. */
const COLUMN_TITLES: Record<BoardColumnId, string> = {
  requests: "New requests",
  quoting: "Estimates & quotes",
  jobs: "Jobs",
  billing: "Billing",
};

/** Worklists refetch when the owner comes back to the tab — the convention every column read uses. */
const WORKLIST = { refetchOnWindowFocus: true } as const;

/** The list shapes this hook maps from. Derived from the routers, so they cannot drift. */
type LeadRow = RouterOutputs["v1"]["customers"]["list"]["items"][number];
type JobRow = RouterOutputs["v1"]["jobs"]["list"]["items"][number];
type InvoiceRow = RouterOutputs["v1"]["invoicing"]["list"]["items"][number];
/** Any list row carrying the DTO's own customer name — jobs and invoices both do. */
type NamedRow = { id: string; customerName: string | null };

// ---- pure composition ---------------------------------------------------------

/** One fetch's state, reduced to what the board needs to know about it. */
export interface BoardSource {
  readonly isFetched: boolean;
  readonly isError: boolean;
  /** Something usable is in hand — a failed refetch over a warm cache is not a broken board. */
  readonly hasData: boolean;
}

/**
 * Book-wide figures, in the units their endpoint reports them in.
 *
 * Cents, because that is what the wire carries; the single conversion happens in `dollars()` below
 * rather than at ten call sites. These endpoints have no DTO→store mapper of their own (unlike
 * `toStoreLead` and friends, which convert where they map), so the board is the boundary.
 */
export interface BoardServerFigures {
  /** Leads in the intake view — customers.viewCounts. */
  readonly requestCount?: number;
  /** Finished work nobody has billed — jobs.viewCounts. */
  readonly needsInvoiceCount?: number;
  readonly needsInvoiceCents?: number;
  /** Open bills and what is still owed on them — invoicing.totals. EXCLUDES drafts. */
  readonly openInvoiceCount?: number;
  readonly openInvoiceCents?: number;
}

export type BoardTruncation = Record<BoardColumnId, boolean>;

export interface WorkBoardInputs {
  readonly requests: Lead[];
  readonly getting: GettingRow[];
  readonly out: RailRow[];
  /** Open work. Estimate-kind jobs are dropped here, not by the caller. */
  readonly jobs: Job[];
  readonly needsInvoiceJobs: Job[];
  /** Every open bill, from the four status bands. Duplicates across bands are collapsed. */
  readonly invoices: Invoice[];
  /** Job id → customer name, from the list DTO the store's Job drops. See derive.UNNAMED_CUSTOMER. */
  readonly jobCustomerNames: ReadonlyMap<string, string>;
  /** Invoice id → customer name, from the list DTO the invoices hydrator blanks. Same reason. */
  readonly invCustomerNames: ReadonlyMap<string, string>;
  readonly oks: OkItem[];
  readonly server: BoardServerFigures;
  readonly truncated: BoardTruncation;
  readonly isFetched: boolean;
  readonly isError: boolean;
}

/** Cents → dollars, once, where the count endpoints' figures enter the board. */
const dollars = (cents: number): number => cents / 100;

/** A figure only counts if it IS one — a NaN must never reach a header. */
const finite = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Both figures or neither: half a server total is not a smaller lie than none. */
const sumBoth = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined || b === undefined ? undefined : a + b;

/** The page's own contribution on top of a book-wide figure — silent when there isn't one. */
const plus = (total: number | undefined, extra: number): number | undefined =>
  total === undefined ? undefined : total + extra;

/**
 * A walkthrough is not a job on the board — it is a route to a price, and it already has a card in
 * the quoting column. Expressed as the complement so a kind added later shows up rather than
 * silently vanishing from the one screen that is meant to hold every open piece of work.
 */
const isWorkJob = (job: Job): boolean => job.kind !== "estimate";

/** A capped read that came back full is a page of a longer list, and the column must say so. */
const atCap = (rows: readonly unknown[], cap: number): boolean => rows.length >= cap;

/** The prepared reminders, keyed by the record each one is about. */
function okMap(
  oks: OkItem[],
  kind: OkItem["kind"],
  idOf: (ok: OkItem) => string | undefined,
): Map<string, OkItem> {
  const map = new Map<string, OkItem>();
  for (const ok of oks) {
    if (ok.kind !== kind) continue;
    const id = idOf(ok);
    if (id) map.set(id, ok);
  }
  return map;
}

/**
 * The list DTO's own customer names, merged across every page that carries them.
 *
 * Variadic because the jobs half of the board is TWO reads — open work and finished-unbilled work
 * — feeding ONE map: `jobItem` and `billingItems` are handed the same `jobCustomerNames`, so a
 * name resolved by either page names its card. Blank is not a name; the hydrator writes "".
 */
export function namesById(...rowSets: readonly NamedRow[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rows of rowSets) {
    for (const row of rows) if (row.customerName) map.set(row.id, row.customerName);
  }
  return map;
}

/**
 * The four bill bands, in invStatusKey's own priority order.
 *
 * The order is load-bearing, not cosmetic: the bands are four separate reads, so a bill that
 * crosses its due date between two of them is in both pages at once and `dedupeById` keeps the
 * FIRST copy. Draft → over → partial → sent means the surviving card is the one from the band
 * that needs the most attention — the order the ledger itself ranks by (invoice-sorts.ts).
 */
export function billBands(pages: {
  readonly draft: InvoiceRow[];
  readonly over: InvoiceRow[];
  readonly partial: InvoiceRow[];
  readonly sent: InvoiceRow[];
}): InvoiceRow[][] {
  return [pages.draft, pages.over, pages.partial, pages.sent];
}

/**
 * Which columns are showing a page of a longer list.
 *
 * Quoting does not compute one: its `out` half reports its own cap from the rail, and its
 * `getting` half is fetched at a cap of 200 the rail does not report at all. Billing is the odd
 * one — five reads feed it (finished work plus the four bill bands), and any one of them hitting
 * its cap means the column is a page.
 */
export function boardTruncation(pages: {
  readonly requests: readonly unknown[];
  readonly jobs: readonly unknown[];
  readonly needsInvoice: readonly unknown[];
  readonly bills: readonly (readonly unknown[])[];
  readonly quoting: boolean;
}): BoardTruncation {
  return {
    requests: atCap(pages.requests, REQUEST_CAP),
    quoting: pages.quoting,
    jobs: atCap(pages.jobs, JOB_CAP),
    billing:
      atCap(pages.needsInvoice, BILL_CAP) || pages.bills.some((rows) => atCap(rows, BILL_CAP)),
  };
}

/**
 * One card per bill. See billBands for why the input can contain the same invoice twice, and why
 * the first copy is the right one to keep.
 */
function dedupeById(invoices: Invoice[]): Invoice[] {
  const seen = new Set<string>();
  const kept: Invoice[] = [];
  for (const inv of invoices) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    kept.push(inv);
  }
  return kept;
}

/**
 * The billing header: the whole book, plus the drafts the book's own totals leave out.
 *
 * `jobs.viewCounts` counts finished, unbilled work and `invoicing.totals` counts every open bill —
 * but `totals()` excludes drafts by construction (`ne(status,'draft')`,
 * drizzle-invoice-repository.ts:277), and this column shows drafts. The three sets are disjoint,
 * so the loaded draft cards ADD to the book-wide figures rather than replacing them. Exact up to
 * the draft page's own cap, where `truncated` already states that the column is a page.
 */
function billingFigures(
  invoices: Invoice[],
  server: BoardServerFigures,
): { serverCount?: number; serverDollars?: number } {
  // The drafts actually ON the board — the same set billingItems renders (isOpenBill).
  const drafts = invoices.filter((inv) => !inv.archived && invStatusKey(inv) === "draft");
  const draftDollars = drafts.reduce((sum, inv) => sum + finite(invDue(inv)), 0);
  const bookCents = sumBoth(server.needsInvoiceCents, server.openInvoiceCents);
  return {
    serverCount: plus(sumBoth(server.needsInvoiceCount, server.openInvoiceCount), drafts.length),
    serverDollars: plus(bookCents === undefined ? undefined : dollars(bookCents), draftDollars),
  };
}

/** Fetched when every source is; broken only when a failed one has nothing usable in hand. */
export function boardLoadState(sources: BoardSource[]): { isFetched: boolean; isError: boolean } {
  return {
    isFetched: sources.every((s) => s.isFetched),
    isError: sources.some((s) => s.isError && !s.hasData),
  };
}

/**
 * The board itself: four columns, always, in the order the work moves through the shop.
 *
 * Fixed order and fixed membership regardless of what has loaded — an empty column is a fact about
 * the business ("nothing waiting"), and a board whose columns appear and disappear as reads land
 * is one the owner cannot learn the shape of.
 */
export function assembleBoard(input: WorkBoardInputs): WorkBoardData {
  const oksByEstId = okMap(input.oks, "quote-viewed", (ok) => ok.estimate?.id);
  const oksByInvId = okMap(input.oks, "invoice-overdue", (ok) => ok.invoice?.id);
  const invoices = dedupeById(input.invoices);

  const columns: [BoardColumn, BoardColumn, BoardColumn, BoardColumn] = [
    columnOf("requests", COLUMN_TITLES.requests, input.requests.map(requestItem), {
      serverCount: input.server.requestCount,
      truncated: input.truncated.requests,
    }),
    columnOf("quoting", COLUMN_TITLES.quoting, quotingItems(input.getting, input.out, oksByEstId), {
      truncated: input.truncated.quoting,
    }),
    columnOf(
      "jobs",
      COLUMN_TITLES.jobs,
      input.jobs
        .filter(isWorkJob)
        .map((job) => jobItem(job, input.jobCustomerNames.get(job.id) ?? null)),
      { truncated: input.truncated.jobs },
    ),
    columnOf(
      "billing",
      COLUMN_TITLES.billing,
      billingItems(
        input.needsInvoiceJobs,
        invoices,
        oksByInvId,
        input.jobCustomerNames,
        input.invCustomerNames,
      ),
      { ...billingFigures(invoices, input.server), truncated: input.truncated.billing },
    ),
  ];

  return {
    columns,
    needsYou: needsYouOf(columns),
    isFetched: input.isFetched,
    isError: input.isError,
  };
}

// ---- the hook -----------------------------------------------------------------

/** A list read's rows, or none — the page shape every list endpoint returns. */
const pageRows = <T,>(page: { items: T[] } | undefined): T[] => page?.items ?? [];

/** The book-wide figures the three count endpoints answer, in the units they report them in. */
function serverFiguresFrom(
  leads: RouterOutputs["v1"]["customers"]["viewCounts"] | undefined,
  jobs: RouterOutputs["v1"]["jobs"]["viewCounts"] | undefined,
  money: RouterOutputs["v1"]["invoicing"]["totals"] | undefined,
): BoardServerFigures {
  return {
    requestCount: leads?.intake,
    needsInvoiceCount: jobs?.counts.needsInvoice,
    needsInvoiceCents: jobs?.needsInvoiceCents,
    openInvoiceCount: money?.openCount,
    openInvoiceCents: money?.openCents,
  };
}

/** No contact fields on a summary row; the mapper fills `cust` from the DTO's own name. */
const NO_CONTACT = { cust: "", phone: "", email: undefined } as const;

const sourceOf = (q: { isFetched: boolean; isError: boolean; data: unknown }): BoardSource => ({
  isFetched: q.isFetched,
  isError: q.isError,
  hasData: q.data !== undefined,
});

export function useWorkBoard(): WorkBoardData {
  const today = useMemo(localToday, []);
  const rail = useRailColumns();
  const ok = useOkQueue();

  const intake = api.v1.customers.list.useQuery({ view: "intake", limit: REQUEST_CAP, sort: "created" }, WORKLIST);
  const leadCounts = api.v1.customers.viewCounts.useQuery(undefined, WORKLIST);
  const active = api.v1.jobs.list.useQuery({ activeOnly: true, limit: JOB_CAP }, WORKLIST);
  const ready = api.v1.jobs.list.useQuery({ view: "needsInvoice", today, limit: BILL_CAP }, WORKLIST);
  const jobCounts = api.v1.jobs.viewCounts.useQuery({ today }, WORKLIST);
  const draft = api.v1.invoicing.list.useQuery({ view: "draft", limit: BILL_CAP }, WORKLIST);
  const partial = api.v1.invoicing.list.useQuery({ view: "partial", limit: BILL_CAP }, WORKLIST);
  const sent = api.v1.invoicing.list.useQuery({ view: "sent", limit: BILL_CAP }, WORKLIST);
  // The ok queue's own overdue read, key for key — one fetch feeds the cards and their texts.
  const over = api.v1.invoicing.list.useQuery({ view: "over", limit: BILL_CAP, sort: "oldestUnpaid" }, WORKLIST);
  const totals = api.v1.invoicing.totals.useQuery(undefined, WORKLIST);

  // rail and ok report {isFetched, isError, hasData} themselves — one BoardSource each.
  const load = boardLoadState([
    sourceOf(intake), sourceOf(leadCounts), sourceOf(active), sourceOf(ready), sourceOf(jobCounts),
    sourceOf(draft), sourceOf(partial), sourceOf(sent), sourceOf(over), sourceOf(totals), rail, ok,
  ]);

  return useMemo(() => {
    const requests: LeadRow[] = pageRows(intake.data);
    const jobs: JobRow[] = pageRows(active.data);
    const needsInvoice: JobRow[] = pageRows(ready.data);
    const bills = billBands({
      draft: pageRows(draft.data), over: pageRows(over.data),
      partial: pageRows(partial.data), sent: pageRows(sent.data),
    });
    const billRows: InvoiceRow[] = bills.flat();
    return assembleBoard({
      requests: requests.map(toStoreLead),
      getting: rail.getting,
      out: rail.out,
      jobs: jobs.map(toStoreJob),
      needsInvoiceJobs: needsInvoice.map(toStoreJob),
      invoices: billRows.map((row) => dtoInvoiceSummaryToStore(row, NO_CONTACT)),
      jobCustomerNames: namesById(jobs, needsInvoice),
      invCustomerNames: namesById(billRows),
      oks: ok.items,
      server: serverFiguresFrom(leadCounts.data, jobCounts.data, totals.data),
      truncated: boardTruncation({ requests, jobs, needsInvoice, bills, quoting: rail.outTruncated }),
      isFetched: load.isFetched,
      isError: load.isError,
    });
  }, [
    intake.data, leadCounts.data, active.data, ready.data, jobCounts.data,
    draft.data, over.data, partial.data, sent.data, totals.data,
    rail.getting, rail.out, rail.outTruncated, ok.items, load.isFetched, load.isError,
  ]);
}
