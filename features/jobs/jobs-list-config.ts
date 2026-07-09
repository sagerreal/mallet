/**
 * features/jobs/jobs-list-config.ts
 * Static config for the Jobs list toolbar: which columns can be toggled, and the
 * Status filter options mapped to lifecycle band keys. Customer/Job is a fixed
 * column (always shown); the rest are optional. "Archived" is a special status
 * that swaps the list over to the archived jobs.
 */

import type { BandKey } from "./today-derive";

export type JobColKey = "status" | "when" | "crew" | "amount";

export const JOB_COLS: Record<JobColKey, { label: string; right?: boolean }> = {
  status: { label: "Status" },
  when: { label: "When" },
  crew: { label: "Crew" },
  amount: { label: "Amount", right: true },
};

export const JOB_COL_ORDER: readonly JobColKey[] = ["status", "when", "crew", "amount"];
export const DEFAULT_JOB_COLS: readonly JobColKey[] = ["status", "when", "crew", "amount"];

/** Which set of jobs the list shows — the active work, or the archive. Chosen by
 *  the toolbar toggle, kept separate from the Status filter (which narrows active). */
export type JobsArchiveSet = "active" | "archived";

export interface JobStatusFilter {
  value: string;
  label: string;
  /** Active-band keys this status maps to. */
  keys: BandKey[];
}

/** Status filter options — narrow the ACTIVE list only (Archived is the toggle). */
export const JOB_STATUS_FILTERS: readonly JobStatusFilter[] = [
  { value: "needsSlot", label: "Needs a slot", keys: ["needsSlot"] },
  { value: "today", label: "Today", keys: ["today"] },
  { value: "scheduled", label: "Scheduled", keys: ["thisWeek", "later"] },
  { value: "doneUnbilled", label: "Done, not billed", keys: ["doneUnbilled"] },
  { value: "done", label: "Done", keys: ["done"] },
];
