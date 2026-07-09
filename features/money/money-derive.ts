/**
 * features/money/money-derive.ts
 * Pure derivations for the merged Money ledger — every stage of getting paid as
 * one row: Ready to bill (done job, no invoice) → Draft → Unpaid / Part-paid /
 * Overdue → Paid. No React, no store — unit-testable. Single source for invoice
 * money math (invoice-modal imports these too).
 */

import type { Invoice, Job, Lead } from "@/lib/store/types";
import { jobDoneDate, jobTotal } from "@/features/jobs/today-derive";
import { todayISO } from "@/lib/clock";

// ---- invoice money math (single source; mirrored from the prototype) ---------

/** Sum of recorded payment amounts. */
export function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** What's still owed — total − deposit − payments (floor 0). */
export function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

/** Unpaid past this many days reads as overdue. */
export const INVOICE_OVERDUE_DAYS = 7;

export function invOver(i: Invoice): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  return (i.age ?? 0) > INVOICE_OVERDUE_DAYS;
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

// ---- filtering -----------------------------------------------------------------

export interface MoneyRowFilter {
  statusFilter: string;
  q: string;
}

/** Narrow the ledger: status filter → search. */
export function filterMoneyRows(rows: MoneyRow[], f: MoneyRowFilter): MoneyRow[] {
  let out = rows;
  if (f.statusFilter) out = out.filter((r) => r.statusKey === f.statusFilter);
  const needle = f.q.trim().toLowerCase();
  if (needle) {
    out = out.filter(
      (r) =>
        (r.num ?? "").toLowerCase().includes(needle) ||
        r.cust.toLowerCase().includes(needle) ||
        r.jobTitle.toLowerCase().includes(needle)
    );
  }
  return out;
}
