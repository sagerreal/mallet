/**
 * features/money/money-derive.ts
 * Pure derivations for the merged Money ledger — every stage of getting paid as
 * one row: Ready to bill (done job, no invoice) → Draft → Unpaid / Part-paid /
 * Overdue → Paid. No React, no store — unit-testable. Single source for invoice
 * money math (invoice-modal imports these too).
 */

import type { Invoice, Job, Lead } from "@/lib/store/types";
import { invPaid, invDue } from "@/lib/store/invoice-balance";
import { jobDoneDate, jobTotal } from "@/features/jobs/today-derive";
import { todayISO } from "@/lib/clock";

// ---- invoice money math (single source; mirrored from the prototype) ---------

/**
 * Paid / still-owed: ONE definition, in lib/store/invoice-balance.ts. Re-exported here so the
 * ledger's existing importers are unchanged — five hand-copied versions of this math is what
 * let the same invoice read fully unpaid in the field and part-paid in the office.
 */
export { invPaid, invDue };

/**
 * Past its due date and still owed.
 *
 * The due date is the one the customer agreed to — it comes from the invoice's terms, so a shop
 * that bills net-30 does not get its invoices flagged on day eight. The previous rule was a flat
 * seven days since the invoice was raised, which ignored terms entirely AND could not fire at all:
 * `dtoInvoiceToStore` hard-coded `age: 0`, so every invoice from the database read as zero days
 * old. The Overdue pill never appeared on real data and the Overdue filter returned nothing.
 *
 * A draft is never overdue (it was never sent), and neither is a settled invoice. An invoice with
 * no due date is not overdue either — nothing was promised, so nothing was missed.
 *
 * Must stay in step with `invoiceViewCondition("over")` in modules/invoicing/infra/invoice-views.ts,
 * which is the same rule in SQL. A test asserts the two agree.
 */
export function invOver(i: Invoice, now: Date = new Date()): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  if (!i.dueAt) return false;
  return new Date(i.dueAt).getTime() < now.getTime();
}

/** Runtime status key incl. draft + overdue. */
export function invStatusKey(i: Invoice): string {
  if (i.status === "draft") return "draft";
  if (invOver(i)) return "over";
  if (invDue(i) <= 0) return "paid";
  if (invPaid(i) > 0) return "partial";
  return "sent";
}

/** Status pill styling table (prototype IST) + the ledger-only "ready" state. */
export const IST: Record<string, { l: string; c: string; bg: string }> = {
  ready: { l: "Ready to bill", c: "var(--amber)", bg: "var(--amber-bg)" },
  draft: { l: "Draft", c: "var(--ink-3)", bg: "var(--paper)" },
  sent: { l: "Unpaid", c: "var(--blue)", bg: "var(--blue-bg)" },
  partial: { l: "Part-paid", c: "var(--amber)", bg: "var(--amber-bg)" },
  over: { l: "Overdue", c: "var(--red)", bg: "var(--red-bg)" },
  paid: { l: "Paid", c: "var(--green-700)", bg: "var(--green-50)" },
};

export function liveInvs(invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => !i.archived);
}

export function invCustName(i: Invoice, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === i.leadId);
  return lead?.name ?? i.cust ?? "Customer";
}

/** Card on file from the linked lead, if any. */
export function custCard(i: Invoice, leads: Lead[]): { brand: string; last4: string; via?: string } | null {
  const lead = leads.find((l) => l.id === i.leadId);
  return lead?.card ?? null;
}

/** Done jobs no invoice references — the first stage of the money ledger. */
export function jobsReadyToInvoice(jobs: Job[], invoices: Invoice[]): Job[] {
  return jobs.filter((j) => !j.archived && j.status === "done" && !invoices.some((i) => i.jobId === j.id));
}

/** Calendar days from an ISO date to today (0 = today). */
function daysSince(iso: string): number {
  const base = new Date(todayISO() + "T12:00:00").getTime();
  const d = new Date(iso + "T12:00:00").getTime();
  return Math.max(0, Math.round((base - d) / 86_400_000));
}

// ---- the ledger rows ---------------------------------------------------------

export type MoneyStatusKey = "ready" | "draft" | "sent" | "partial" | "over" | "paid";

export interface MoneyRow {
  key: string;
  kind: "ready" | "invoice";
  num: string | null;
  cust: string;
  jobTitle: string;
  /** One quiet context line that justifies the row's action, or null. */
  sub: string | null;
  statusKey: MoneyStatusKey;
  ageDays: number | null;
  paid: number | null;
  due: number;
  card: { brand: string; last4: string } | null;
  invoiceId: string | null;
  jobId: string | null;
}

/** Needs-you-first rank: bill it → finish it → chase it → fine → done. */
const STATUS_RANK: Record<MoneyStatusKey, number> = {
  ready: 0,
  draft: 1,
  over: 2,
  partial: 3,
  sent: 4,
  paid: 5,
};

function invoiceRow(i: Invoice, leads: Lead[]): MoneyRow {
  const sk = invStatusKey(i) as MoneyStatusKey;
  const card = custCard(i, leads);
  const reminders = i.fu?.on && (i.fu.stage ?? 0) > 0 ? i.fu.stage : 0;
  const sub =
    reminders > 0
      ? `${reminders} reminder${reminders === 1 ? "" : "s"} sent`
      : card && invDue(i) > 0
        ? `${card.brand} ···· ${card.last4} on file`
        : null;
  return {
    key: i.id,
    kind: "invoice",
    num: i.num,
    cust: invCustName(i, leads),
    jobTitle: i.title,
    sub,
    statusKey: sk,
    ageDays: i.status === "draft" ? null : i.age ?? 0,
    paid: invPaid(i) + (i.depPaid ?? 0),
    due: invDue(i),
    card: card ? { brand: card.brand, last4: card.last4 } : null,
    invoiceId: i.id,
    jobId: i.jobId,
  };
}

function readyRow(j: Job, leads: Lead[]): MoneyRow {
  const done = jobDoneDate(j);
  return {
    key: `job-${j.id}`,
    kind: "ready",
    num: null,
    cust: leads.find((l) => l.id === j.leadId)?.name ?? "Customer",
    jobTitle: j.title,
    sub: "built from what was sold + field add-ons",
    statusKey: "ready",
    ageDays: done ? daysSince(done) : 0,
    paid: null,
    due: jobTotal(j),
    card: null,
    invoiceId: null,
    jobId: j.id,
  };
}

/** The active ledger: ready-to-bill jobs + live invoices, needs-you first. */
export function deriveMoneyRows(invoices: Invoice[], jobs: Job[], leads: Lead[]): MoneyRow[] {
  const rows = [
    ...jobsReadyToInvoice(jobs, invoices).map((j) => readyRow(j, leads)),
    ...liveInvs(invoices).map((i) => invoiceRow(i, leads)),
  ];
  return rows.sort(
    (a, b) =>
      STATUS_RANK[a.statusKey] - STATUS_RANK[b.statusKey] || b.due - a.due || (b.ageDays ?? 0) - (a.ageDays ?? 0)
  );
}

/** The archived ledger — archived invoices only (a job can't archive unbilled). */
export function deriveArchivedMoneyRows(invoices: Invoice[], leads: Lead[]): MoneyRow[] {
  return invoices.filter((i) => i.archived).map((i) => invoiceRow(i, leads));
}

// Filtering used to live here, over the rows the browser happened to hold. It moved to SQL —
// modules/invoicing/infra/invoice-views.ts for status, the repository's listConds for search — so
// that a filter describes the whole ledger instead of the loaded page.
