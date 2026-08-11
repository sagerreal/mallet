/**
 * features/jobs/jobs-helpers.ts
 * Shared, pure derivations over jobs/leads/visits used across the Jobs feature
 * (list, schedule board, timesheets). No React, no store access — takes the
 * arrays it needs so every function is unit-testable.
 */

import { todayISO } from "@/lib/clock";
import type { Job, Lead, Tech, Visit } from "@/lib/store/types";
import { isVisitPlaced, isVisitDatedUnassigned } from "@/lib/store/visit-placement";
import { SVC_KIND, isEstimateJob, hasPricedLines } from "./job-status-meta";

// A job visit held for board placement (estimate visits are jobs too — svc "estimate").
// ownerId is a Job.id (UUID string).
export type Held = { kind: "job"; ownerId: string; visitId: string };

export interface BoardItem {
  kind: "job";
  ownerId: string;
  name: string;
  /** The job's own title — what the block prints. The customer name stays in the tooltip. */
  title: string | null;
  mode: string;
  v: Visit;
}

/** Total date+start ordering — a proper (transitive) comparator for visits. */
function byDateStart(a: Visit, b: Visit): number {
  const ad = a.date ?? "";
  const bd = b.date ?? "";
  return ad > bd ? 1 : ad < bd ? -1 : (a.start ?? 0) - (b.start ?? 0);
}

export function liveJobs(jobs: Job[]): Job[] {
  return jobs.filter((j) => !j.archived);
}

export function custName(j: Job, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === j.leadId);
  return lead?.name ?? (j as { cust?: string }).cust ?? "—";
}

export function custPhone(j: Job, leads: Lead[]): string {
  return j.phone || leads.find((l) => l.id === j.leadId)?.phone || "";
}

/** Age in days of the job's originating lead (0 if none) — drives the aging rail. */
export function leadAgeOf(j: Job, leads: Lead[]): number {
  return leads.find((l) => l.id === j.leadId)?.age ?? 0;
}

/** The board lane a job reads as: estimate, priced install, or price-on-site. */
export function jobMode(j: Job): string {
  if (isEstimateJob(j)) return SVC_KIND.estimate;
  return hasPricedLines(j) ? SVC_KIND.install : SVC_KIND.service;
}

/** The next placed visit (today or later), else the latest placed visit, else null. */
export function jobNextVisit(j: Job): Visit | null {
  const today = todayISO();
  const placed = (j.visits ?? []).filter(isVisitPlaced);
  const future = placed.filter((v) => (v.date ?? "") >= today);
  if (future.length) return [...future].sort(byDateStart)[0] as Visit;
  return [...placed].sort(byDateStart).at(-1) ?? null;
}

/**
 * The earliest visit that has a day but NOBODY on it — a half-planned job, or null.
 *
 * A job in "Needs a slot" is usually there because nothing has been put on a day at all, and the
 * row says how long it has been sold. Some are there because a day was chosen and the crew was
 * never assigned (or was unassigned again): those DO have a date, and printing "sold 4d ago" over
 * a job that is already pencilled in for Friday hides the half of the plan that exists.
 */
export function jobDatedUnassignedVisit(j: Job): Visit | null {
  const half = (j.visits ?? []).filter(isVisitDatedUnassigned);
  return half.length ? ([...half].sort(byDateStart)[0] as Visit) : null;
}

export function jobsUnscheduled(jobs: Job[]): Job[] {
  return liveJobs(jobs).filter(
    (j) => j.status !== "done" && ((j.visits ?? []).length === 0 || (j.visits ?? []).some((v) => !isVisitPlaced(v)))
  );
}

export function visitsToday(jobs: Job[]): Array<{ j: Job; v: Visit }> {
  const today = todayISO();
  const out: Array<{ j: Job; v: Visit }> = [];
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.date === today) out.push({ j, v });
    })
  );
  return out;
}

export function dayLoad(jobs: Job[], techId: string, iso: string): number {
  let total = 0;
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === iso) total += v.dur ?? 0;
    })
  );
  return total;
}

export function techById(techs: Tech[], id: string): Tech | undefined {
  return techs.find((t) => t.id === id);
}

/** All placed visits for one crew on one day, time-sorted (estimate visits are jobs too). */
export function boardItemsFor(jobs: Job[], leads: Lead[], techId: string, iso: string): BoardItem[] {
  const items: BoardItem[] = [];
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === iso)
        items.push({ kind: "job", ownerId: j.id, name: custName(j, leads), title: j.title ?? null, mode: jobMode(j), v });
    })
  );
  return items.sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));
}
