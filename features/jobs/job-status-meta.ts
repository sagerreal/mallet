/**
 * features/jobs/job-status-meta.ts
 * Single source of truth for job/visit status + service-kind vocabulary and
 * their display metadata. Replaces the JST / SVC_META literals that had drifted
 * across the jobs surfaces.
 */

/** Job & visit lifecycle status values (as stored on the record). */
export const JOB_STATUS = {
  unscheduled: "unscheduled",
  scheduled: "scheduled",
  enroute: "enroute",
  onsite: "onsite",
  done: "done",
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** Which lane on the board a job reads as — its "service mode". */
export const SVC_KIND = { estimate: "estimate", service: "service", install: "install" } as const;
export type SvcKind = (typeof SVC_KIND)[keyof typeof SVC_KIND];

/** A held/placed item on the schedule board is either a job or an estimate visit. */
export const BOARD_ITEM_KIND = { job: "job" } as const;
export type BoardItemKind = (typeof BOARD_ITEM_KIND)[keyof typeof BOARD_ITEM_KIND];

/**
 * Is this an ESTIMATE job — someone still has to look at the work before there is a price?
 *
 * `jobs.kind` is the source of truth (the closed enum the DB constrains; backfilled in 0133).
 * The `svc === 'estimate'` fallback covers only a record hydrated into the store before the
 * writers switched — the column itself carries no 'estimate' values anymore.
 *
 * ONE predicate on purpose. Four hand-maintained copies of `svc === "estimate"` (board, office
 * modal, tech modal, pipeline) are how a voice-booked estimate — which set `kind` and put the
 * spoken service name in `svc` — rendered as regular work on every one of them.
 */
export function isEstimateJob(j: { kind?: string; svc?: string | null }): boolean {
  return j.kind === "estimate" || j.svc === SVC_KIND.estimate;
}

/** The job carries at least one real priced line — a signed on-site quote writes these. */
export function hasPricedLines(j: { lines?: { q?: number | null; r?: number | null }[] }): boolean {
  return (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
}

/**
 * A PURE scoping visit: an estimate job nobody has priced yet. This — not "is an estimate" — is
 * what hides the Price section and keeps the job out of billing. The distinction is the fix for
 * a real bug: a quote signed at the door writes priced lines onto the job, and the old
 * `svc === 'estimate'` gate kept hiding the price of a job that had a signature behind it.
 */
export function isUnpricedEstimateJob(j: {
  kind?: string;
  svc?: string | null;
  lines?: { q?: number | null; r?: number | null }[];
}): boolean {
  return isEstimateJob(j) && !hasPricedLines(j);
}

/** Status pill display (label · text color · background). */
export const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

export interface SvcMeta {
  lbl: string;
  word: string;
  tag: string;
  edge: string;
  c: string;
  est?: boolean;
}

export const SVC_META: Record<string, SvcMeta> = {
  estimate: { lbl: "Estimate", word: "Estimate", tag: "Est", edge: "var(--amber)", c: "var(--amber)", est: true },
  service: { lbl: "Price on site", word: "Job", tag: "Job", edge: "#9C5B34", c: "#9C5B34" },
  install: { lbl: "Priced", word: "Job", tag: "Job", edge: "#4A639E", c: "#4A639E" },
};

/** Always returns a valid SvcMeta — falls back to service. */
export function svcMeta(key: string): SvcMeta {
  return SVC_META[key] ?? (SVC_META.service as SvcMeta);
}
