/**
 * features/jobs/today-derive.ts
 * Leaf helpers for job rows plus the band TYPES. The band derivations themselves
 * (deriveJobBands & co) were browser math over one page of the store and are gone —
 * bands now arrive from the server (see server-rows.ts); only the shapes live here.
 */

import { todayISO } from "@/lib/clock";
import type { Job, Visit } from "@/lib/store/types";

export function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

const placed = (v: Visit) => v.date != null && v.techId != null && v.start != null;

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

/** The date a job was completed — its latest done visit, or null if not done. */
export function jobDoneDate(job: Job): string | null {
  const dates = (job.visits ?? [])
    .filter((v) => v.status === "done" && v.date)
    .map((v) => v.date as string);
  return dates.length ? [...dates].sort().at(-1)! : null;
}

