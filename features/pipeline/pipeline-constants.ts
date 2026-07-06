/**
 * features/pipeline/pipeline-constants.ts
 * Single source of truth for stage keys, labels, and norms.
 * Stage keys match the prototype's state.leads[].stage values exactly.
 */

/** All pipeline stages in board order (Lost is excluded from columns). */
export const STAGE_ORDER = [
  "New customer",
  "Contacted",
  "Quote Sent",
  "Won",
] as const;

/** Stages that count as "active" for stale-detection and active-count. */
export const ACTIVE_STAGES: readonly string[] = [
  "New customer",
  "Contacted",
  "Quote Sent",
];

/** Column header label overrides (Won shows a 30-day window hint). */
export const STAGE_LABEL: Record<string, string> = {
  Won: "Won · 30d",
};

/**
 * Normal (healthy) age in days per stage before a card is flagged.
 * Mirrors prototype stageNorm().
 */
export const STAGE_NORMS: Record<string, number> = {
  "New customer": 2,
  Contacted: 4,
  "Quote Sent": 7,
  Won: 999,
  Lost: 999,
};

export function stageNorm(stage: string): number {
  return STAGE_NORMS[stage] ?? 5;
}

/** Age threshold (days) used to identify stale leads for the Clean-up badge. */
export const STALE_AGE = 10;

/** One stale-lead predicate for the Clean-up badge, sweep list and customers page. */
export function isStaleLead(l: { stage: string; age: number; archived?: boolean }): boolean {
  return !l.archived && ACTIVE_STAGES.includes(l.stage) && l.age >= STALE_AGE;
}

/** Won column only shows leads won within this many days. */
export const WON_WINDOW_DAYS = 30;
