/**
 * features/pipeline/pipeline-utils.ts
 * Shared board derivations (used by both the card and the column so the two
 * can never drift).
 */

import { estTotal } from "@/lib/estimates";
import { isEstimateJob, SVC_KIND } from "@/features/jobs/job-status-meta";
import type { Lead, Estimate, Job, Visit } from "@/lib/store/types";

/** A lead's board value — its first non-draft quote total, else the stated value. */
export function leadVal(lead: Lead, estimates: Estimate[]): number {
  const e = estimates.find((e) => e.leadId === lead.id && e.status !== "draft");
  return e ? estTotal(e) : (lead.value ?? 0);
}

/**
 * Estimate visits are real jobs (kind 'estimate') since the evisit machinery was
 * deleted — a lead's walkthrough state is read off its estimate jobs' visits.
 */
const estimateJobs = (leadId: string, jobs: Job[]): Job[] =>
  jobs.filter((j) => j.leadId === leadId && isEstimateJob(j) && !j.archived);

/**
 * The visit that came back with scope notes AND the job it belongs to, or undefined.
 *
 * The job rides along because the scoped card's "quote it ›" hands the composer that job id
 * (?job=) — the quote it drafts then points back at this walkthrough, and accepting it CONVERTS
 * the job into the sold work instead of minting a duplicate.
 */
export function scopedEstimateVisitWithJob(
  leadId: string,
  jobs: Job[],
): { job: Job; visit: Visit } | undefined {
  for (const j of estimateJobs(leadId, jobs)) {
    const v = (j.visits ?? []).find((v) => v.scopeNotes);
    if (v) return { job: j, visit: v };
  }
  return undefined;
}

/** The visit that came back with scope notes, or undefined. */
export function scopedEstimateVisit(leadId: string, jobs: Job[]): Visit | undefined {
  return scopedEstimateVisitWithJob(leadId, jobs)?.visit;
}

/** A walkthrough on the books: scheduled, dated, not yet scoped. */
export function pendingEstimateVisit(leadId: string, jobs: Job[]): Visit | undefined {
  for (const j of estimateJobs(leadId, jobs)) {
    const v = (j.visits ?? []).find((v) => v.status === "scheduled" && !v.scopeNotes && v.date);
    if (v) return v;
  }
  return undefined;
}

/** Scoped on site but never quoted — the office still owes this lead a quote. */
export function isScopedNeedsQuote(lead: Lead, estimates: Estimate[], jobs: Job[]): boolean {
  if (lead.stage === "Won" || lead.stage === "Lost") return false;
  const visited = scopedEstimateVisit(lead.id, jobs) != null;
  return visited && !estimates.some((e) => e.leadId === lead.id);
}
