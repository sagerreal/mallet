/**
 * features/board/derive.ts
 * WHAT APPEARS IN WHICH COLUMN, AND WHY — the whole rule set for the work board,
 * as pure functions over rows other derivations already built.
 *
 * Nothing here re-derives a fact that exists upstream: quote staleness and warmth come off the
 * RailRow, intake wording off intakeRowOf, a visit's day off visitLabel, "is this bill overdue"
 * off invStatusKey. That is deliberate — a second copy of any of those rules is a second answer
 * to the same question, and the board would disagree with the screen the card opens.
 *
 * TONE follows one rule with two exceptions: work the shop owes reads `attention`, work somebody
 * else owes reads `waiting`; a crew actually on site reads `active`, and a bill past the date the
 * customer agreed to reads `overdue`.
 */

import { estTotal } from "@/lib/estimates";
import { colLabel } from "@/lib/time";
import { isVisitPlaced } from "@/lib/store/visit-placement";
import { visitLabel, type OkItem } from "@/features/home/derive";
import { intakeRowOf, type GettingRow } from "@/features/pipeline/working";
import type { RailRow } from "@/features/quotes/derive";
import { invDue, invStatusKey } from "@/features/money/money-derive";
import { jobDoneDate, jobTotal } from "@/features/jobs/today-derive";
import { jobDatedUnassignedVisit, jobNextVisit } from "@/features/jobs/jobs-helpers";
import type { Estimate, Invoice, Job, Lead, Visit } from "@/lib/store/types";
import type { BoardColumn, BoardColumnId, BoardItem, BoardTone, WorkBoardData } from "./types";

/**
 * What a card says when no customer name reached it.
 *
 * The store's `Job` carries no customer name (the summary DTO's `customerName` is dropped by the
 * hydrator's mapper), so callers pass it in. Same word the money ledger already uses for the same
 * gap — a card that cannot name its customer says so plainly rather than printing an id or "—".
 */
export const UNNAMED_CUSTOMER = "Customer";

/** Dollars, defensively: an absent or non-finite figure is 0 (= unpriced), never NaN in a sum. */
const money = (n: number | null | undefined): number =>
  typeof n === "number" && Number.isFinite(n) ? n : 0;

/** The one tone rule; the two exceptions are set explicitly at their call sites. */
const toneFor = (needsAction: boolean): BoardTone => (needsAction ? "attention" : "waiting");

/** A card's needs-action state and how it is worded — the three fields that always move together. */
type StateView = Pick<BoardItem, "stateLabel" | "tone" | "needsAction">;

// ---- requests ----------------------------------------------------------------

/**
 * An intake lead — somebody asked for something and nobody has answered.
 *
 * Membership is the server's (`view: "intake"`), so there is no predicate here: every lead handed
 * to this function is, by construction, waiting on the shop.
 */
export function requestItem(lead: Lead): BoardItem {
  return {
    key: `bl-${lead.id}`,
    kind: "lead",
    column: "requests",
    refId: lead.id,
    leadId: lead.id,
    name: lead.name,
    service: lead.job,
    valueDollars: money(lead.value),
    stateLabel: "Needs response",
    tone: "attention",
    needsAction: true,
    ageLabel: intakeRowOf(lead).stamp,
  };
}

// ---- quoting -----------------------------------------------------------------

/** The three routes to a price, and which of them the OFFICE owes the next move on. */
const GETTING_STATE: Record<GettingRow["kind"], StateView> = {
  scoped: { stateLabel: "Needs quote", tone: "attention", needsAction: true },
  shop: { stateLabel: "Draft in progress", tone: "attention", needsAction: true },
  visit: { stateLabel: "Walkthrough booked", tone: "waiting", needsAction: false },
};

/**
 * A deal on its way to a price. With paper in hand the card opens the QUOTE; without it there is
 * no estimate to open yet, so it opens the customer — the record that does exist.
 */
function gettingItem(row: GettingRow): BoardItem {
  const est: Estimate | null = row.est;
  return {
    key: est ? `be-${est.id}` : `bl-${row.lead.id}`,
    kind: est ? "estimate" : "lead",
    column: "quoting",
    refId: est ? est.id : row.lead.id,
    leadId: row.lead.id,
    name: row.lead.name,
    service: est?.title ?? row.lead.job,
    valueDollars: est ? money(estTotal(est)) : 0,
    ...GETTING_STATE[row.kind],
    ageLabel: row.stamp,
  };
}

/** A quote sitting on a customer's phone. A prepared reminder is what makes it the shop's move. */
function sentQuoteItem(row: RailRow, oksByEstId: Map<string, OkItem>): BoardItem {
  const ok = oksByEstId.get(row.est.id);
  return {
    key: `be-${row.est.id}`,
    kind: "estimate",
    column: "quoting",
    refId: row.est.id,
    leadId: row.est.leadId,
    name: row.customerName,
    service: row.est.title,
    valueDollars: money(row.total),
    stateLabel: ok ? "Reminder due" : "Awaiting customer",
    tone: toneFor(Boolean(ok)),
    needsAction: Boolean(ok),
    ageLabel: row.stamp,
    ...(ok ? { ok } : {}),
  };
}

export function quotingItems(
  getting: GettingRow[],
  out: RailRow[],
  oksByEstId: Map<string, OkItem>,
): BoardItem[] {
  return [...getting.map(gettingItem), ...out.map((row) => sentQuoteItem(row, oksByEstId))];
}

// ---- jobs --------------------------------------------------------------------

/** A crew is standing on the job right now — the store's word for it is the visit's status. */
const onsiteVisit = (job: Job): Visit | undefined =>
  (job.visits ?? []).find((v) => v.status === "onsite");

/**
 * NOT ON A DAY WITH A CREW — the client twin of the server's `needsSlot` view.
 *
 * `isVisitPlaced` is the shared rule (lib/store/visit-placement.ts). Its one documented difference
 * from the SQL is that it also requires a start time; using the shared predicate rather than a
 * fourth copy is what keeps this column and the Jobs screen naming the same jobs.
 */
const needsSlot = (job: Job): boolean => !(job.visits ?? []).some(isVisitPlaced);

function jobState(job: Job): StateView {
  if (onsiteVisit(job)) return { stateLabel: "On site", tone: "active", needsAction: false };
  if (needsSlot(job)) return { stateLabel: "Needs scheduling", tone: "attention", needsAction: true };
  return { stateLabel: "Scheduled", tone: "waiting", needsAction: false };
}

/**
 * When the work is. The next placed visit's own label, or — for a job that has a day but nobody
 * on it — that day, naming what is missing. Blank when nothing has been decided: an empty stamp
 * is honest, and "Needs scheduling" has already said it.
 */
function jobAgeLabel(job: Job): string {
  const onsite = onsiteVisit(job);
  if (onsite) return visitLabel(onsite);
  const next = jobNextVisit(job);
  if (next) return visitLabel(next);
  const half = jobDatedUnassignedVisit(job);
  return half?.date && half.start != null ? `${visitLabel(half)} · no crew` : "";
}

/**
 * One work-kind job. The caller filters (estimate-kind jobs surface as GettingRows) and supplies
 * `customerName` from the list DTO — see UNNAMED_CUSTOMER for why it cannot come off the record.
 */
export function jobItem(job: Job, customerName?: string): BoardItem {
  return {
    key: `bj-${job.id}`,
    kind: "job",
    column: "jobs",
    refId: job.id,
    leadId: job.leadId,
    name: customerName ?? UNNAMED_CUSTOMER,
    service: job.title,
    valueDollars: money(jobTotal(job)),
    ...jobState(job),
    ageLabel: jobAgeLabel(job),
  };
}

// ---- billing -----------------------------------------------------------------

/** Work that is finished and not yet billed — the money leak the column exists to close. */
function readyToBillItem(job: Job, customerName?: string): BoardItem {
  const done = jobDoneDate(job);
  return {
    key: `bj-${job.id}`,
    kind: "job",
    column: "billing",
    refId: job.id,
    leadId: job.leadId,
    name: customerName ?? UNNAMED_CUSTOMER,
    service: job.title,
    valueDollars: money(jobTotal(job)),
    stateLabel: "Ready to bill",
    tone: "attention",
    needsAction: true,
    ageLabel: done ? `Done ${colLabel(done)}` : "",
  };
}

/** Bill state → how the card reads. "over" is invStatusKey's, i.e. the terms the customer agreed. */
function invoiceState(statusKey: string): StateView {
  if (statusKey === "draft") return { stateLabel: "Draft invoice", tone: "attention", needsAction: true };
  if (statusKey === "over") return { stateLabel: "Overdue", tone: "overdue", needsAction: true };
  return { stateLabel: "Awaiting payment", tone: "waiting", needsAction: false };
}

function invoiceItem(inv: Invoice, ok: OkItem | undefined): BoardItem {
  return {
    key: `bi-${inv.id}`,
    kind: "invoice",
    column: "billing",
    refId: inv.id,
    leadId: inv.leadId,
    name: inv.cust || UNNAMED_CUSTOMER,
    service: inv.title,
    valueDollars: money(invDue(inv)),
    ...invoiceState(invStatusKey(inv)),
    ageLabel: inv.age > 0 ? `Raised ${inv.age}d ago` : "Raised today",
    ...(ok ? { ok } : {}),
  };
}

/** Settled or filed away — money that needs nobody. Not a silent drop: it is not open work. */
const isOpenBill = (inv: Invoice): boolean => !inv.archived && invStatusKey(inv) !== "paid";

export function billingItems(
  needsInvoiceJobs: Job[],
  invoices: Invoice[],
  oksByInvId: Map<string, OkItem>,
  /** Job id → customer name, from the list DTO the store's Job drops. See UNNAMED_CUSTOMER. */
  jobCustomerNames?: ReadonlyMap<string, string>,
): BoardItem[] {
  return [
    ...needsInvoiceJobs.map((job) => readyToBillItem(job, jobCustomerNames?.get(job.id))),
    ...invoices.filter(isOpenBill).map((inv) => invoiceItem(inv, oksByInvId.get(inv.id))),
  ];
}

// ---- columns -----------------------------------------------------------------

/**
 * Needs-action first, then the biggest money, then alphabetically.
 *
 * The last clause is not decoration: without a total order the same board redraws in a different
 * sequence on every refetch, and a card the owner was reaching for moves under the cursor.
 * Returns a new array — the input is never reordered.
 */
export function rankItems(items: BoardItem[]): BoardItem[] {
  return [...items].sort(
    (a, b) =>
      Number(b.needsAction) - Number(a.needsAction) ||
      money(b.valueDollars) - money(a.valueDollars) ||
      a.name.localeCompare(b.name),
  );
}

export function columnOf(
  id: BoardColumnId,
  title: string,
  items: BoardItem[],
  opts?: { serverCount?: number; serverDollars?: number; truncated?: boolean },
): BoardColumn {
  const ranked = rankItems(items);
  return {
    id,
    title,
    items: ranked,
    // The server counted the whole book; the items are one capped page of it. Where it has an
    // answer it wins, so a header cannot read "5" over a column that holds thirty.
    count: opts?.serverCount ?? ranked.length,
    valueDollars: opts?.serverDollars ?? ranked.reduce((sum, i) => sum + money(i.valueDollars), 0),
    truncated: opts?.truncated ?? false,
  };
}

/** The one figure at the top: what is waiting on the shop, and how much of it is already drafted. */
export function needsYouOf(columns: BoardColumn[]): WorkBoardData["needsYou"] {
  const mine = columns.flatMap((c) => c.items).filter((i) => i.needsAction);
  return {
    count: mine.length,
    valueDollars: mine.reduce((sum, i) => sum + money(i.valueDollars), 0),
    textsReady: mine.filter((i) => i.ok).length,
  };
}
