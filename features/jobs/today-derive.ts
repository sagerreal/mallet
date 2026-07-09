/**
 * features/jobs/today-derive.ts
 * Pure derivations for the Jobs list. "On the trucks" is today's placed, not-done
 * money. The lifecycle bands give each job its status + default order. A job that
 * has been done AND billed for a week auto-archives — it leaves the active list
 * for the Archived filter, so finished business clears itself (no manual clean-up).
 * Everything derives from the store.
 */

import { todayISO } from "@/lib/clock";
import type { Invoice, Job, Visit } from "@/lib/store/types";

export function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

const live = (jobs: Job[]) => jobs.filter((j) => !j.archived);
const placed = (v: Visit) => v.date != null && v.techId != null && v.start != null;

/** Today's dollars on the trucks — jobs with a placed visit today, not yet done. */
export function deriveOnTrucks(jobs: Job[]): number {
  const today = todayISO();
  return live(jobs)
    .filter((j) => j.status !== "done" && (j.visits ?? []).some((v) => v.date === today && placed(v)))
    .reduce((s, j) => s + jobTotal(j), 0);
}

/** Today's visit for a job (placed, dated today), or null. */
export function todayVisit(j: Job): Visit | null {
  const today = todayISO();
  return (j.visits ?? []).find((v) => v.date === today && placed(v)) ?? null;
}

// ---- the banded ledger — each job lands in exactly one band ------------------

export type BandKey = "needsSlot" | "today" | "thisWeek" | "later" | "doneUnbilled" | "done" | "archived";

export interface JobBand {
  key: BandKey;
  label: string;
  /** Amber = a money leak the owner should clear. */
  amber: boolean;
  jobs: Job[];
  count: number;
  sum: number;
}

/** A job is billed if any non-archived invoice points at it (by job id, or by
 *  lead when the invoice carries no job id). */
function isBilled(job: Job, invoices: Invoice[]): boolean {
  return invoices.some(
    (i) => !i.archived && (i.jobId === job.id || (i.jobId == null && i.leadId === job.leadId))
  );
}

function nextVisit(job: Job): Visit | null {
  const today = todayISO();
  const upcoming = (job.visits ?? [])
    .filter((v) => placed(v) && (v.date ?? "") >= today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.start ?? 0) - (b.start ?? 0));
  return upcoming[0] ?? null;
}

/** Days from today to an ISO date (business-agnostic; just calendar days). */
function daysOut(iso: string): number {
  const base = new Date(todayISO() + "T12:00:00").getTime();
  const d = new Date(iso + "T12:00:00").getTime();
  return Math.round((d - base) / 86_400_000);
}

/** The date a job was completed — its latest done visit, or null if not done. */
export function jobDoneDate(job: Job): string | null {
  const dates = (job.visits ?? [])
    .filter((v) => v.status === "done" && v.date)
    .map((v) => v.date as string);
  return dates.length ? [...dates].sort().at(-1)! : null;
}

/** A done + billed job auto-archives once it's been this many days since it wrapped. */
export const JOB_ARCHIVE_AFTER_DAYS = 7;

/** Auto-archive: finished business (done AND billed) that wrapped a week+ ago.
 *  Unbilled done jobs never auto-archive — they stay visible as the money leak. */
function autoArchived(job: Job, invoices: Invoice[]): boolean {
  if (job.status !== "done" || !isBilled(job, invoices)) return false;
  const d = jobDoneDate(job);
  return d != null && -daysOut(d) >= JOB_ARCHIVE_AFTER_DAYS;
}

/** A job is archived if explicitly archived or auto-archived (done+billed, aged out). */
export function isArchivedJob(job: Job, invoices: Invoice[]): boolean {
  return Boolean(job.archived) || autoArchived(job, invoices);
}

function band(key: BandKey, label: string, amber: boolean, jobs: Job[]): JobBand {
  return { key, label, amber, jobs, count: jobs.length, sum: jobs.reduce((s, j) => s + jobTotal(j), 0) };
}

export function deriveJobBands(jobs: Job[], invoices: Invoice[]): JobBand[] {
  // Active = live (not explicitly archived) minus the auto-archived (done+billed, aged out).
  const ls = live(jobs).filter((j) => !autoArchived(j, invoices));

  const needsSlot = ls
    .filter((j) => j.status === "unscheduled")
    .sort((a, b) => jobTotal(b) - jobTotal(a));

  const scheduled = ls
    .filter((j) => j.status !== "unscheduled" && j.status !== "done" && nextVisit(j))
    .sort((a, b) => {
      const na = nextVisit(a)!;
      const nb = nextVisit(b)!;
      return (na.date ?? "").localeCompare(nb.date ?? "") || (na.start ?? 0) - (nb.start ?? 0);
    });
  // A job with work today lives in "Today" — never also in a week band.
  const today = scheduled.filter((j) => todayVisit(j));
  const rest = scheduled.filter((j) => !todayVisit(j));
  const thisWeek = rest.filter((j) => daysOut(nextVisit(j)!.date!) <= 7);
  const later = rest.filter((j) => daysOut(nextVisit(j)!.date!) > 7);

  const doneJobs = ls.filter((j) => j.status === "done");
  const doneUnbilled = doneJobs.filter((j) => !isBilled(j, invoices));
  const done = doneJobs.filter((j) => isBilled(j, invoices));

  return [
    band("needsSlot", "Needs a slot", true, needsSlot),
    band("today", "Today", false, today),
    band("thisWeek", "This week", false, thisWeek),
    band("later", "Upcoming", false, later),
    band("doneUnbilled", "Done, not billed", true, doneUnbilled),
    band("done", "Done", false, done),
  ].filter((b) => b.count > 0);
}

/** The archived jobs as a single band (most-recently-wrapped first). */
export function deriveArchivedBands(jobs: Job[], invoices: Invoice[]): JobBand[] {
  const archived = jobs
    .filter((j) => isArchivedJob(j, invoices))
    .sort((a, b) => (jobDoneDate(b) ?? "").localeCompare(jobDoneDate(a) ?? ""));
  return archived.length ? [band("archived", "Archived", false, archived)] : [];
}
