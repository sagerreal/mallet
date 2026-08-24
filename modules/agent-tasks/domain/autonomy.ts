import type { RiskTier } from "@mallet/ai";

/**
 * modules/agent-tasks/domain/autonomy.ts
 * How much the shop lets the employee do without asking. Pure, and read LIVE from org_settings
 * immediately before the approval decision that consumes it — never snapshotted onto a task, and
 * never read any earlier in the wake (see agent-task-runner.ts's `wakeOne`), because a permission
 * downgrade that does not reach work already in flight is not a permission control.
 *
 * money and destructive never auto-approve at any level. Autonomous is therefore not "more
 * tiers" — it is permission to work UNATTENDED: to advance work nobody started and to open its
 * own follow-ups. Until routines and triggers exist, that is the only difference from assisted,
 * and saying so is better than inventing a level whose meaning is a removed safety rail.
 */
export const AUTONOMY_LEVELS = ["supervised", "assisted", "autonomous"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const DEFAULT_AUTONOMY: AutonomyLevel = "supervised";

// `autonomous` is BYTE-IDENTICAL to `assisted` on purpose, not a placeholder someone forgot to
// finish. The autonomous UI copy promises Artie "works on its own initiative and opens its own
// follow-ups" — that behaviour is `canRunUnattended` below, and it has ZERO production callers
// today: routines and triggers (what would actually call it) are deferred, not built. Until they
// ship, there is nothing for a wider auto-approve set to gate, so widening this row would grant a
// permission with no corresponding capability to use it responsibly. Do NOT "de-duplicate" these
// two rows into one — when routines/triggers land, `autonomous` is meant to diverge from
// `assisted` right here, and this table is where that change belongs.
const AUTO_APPROVED: Record<AutonomyLevel, readonly RiskTier[]> = {
  supervised: [],
  assisted: ["comms", "operational"],
  autonomous: ["comms", "operational"],
};

export const isAutonomyLevel = (value: string): value is AutonomyLevel =>
  (AUTONOMY_LEVELS as readonly string[]).includes(value);

export const autoApproves = (tier: RiskTier, level: AutonomyLevel): boolean => {
  if (tier === "money" || tier === "destructive") return false;
  if (!isAutonomyLevel(level)) return false; // an unknown value fails closed
  return AUTO_APPROVED[level].includes(tier);
};

/**
 * May the runner advance work no human started, and may the agent open follow-up tasks?
 *
 * A DEAD SEAM today, deliberately: this has ZERO production callers. It is the hook routines and
 * triggers will call once built — the only thing "autonomous" is meant to unlock beyond
 * `assisted` (see `AUTO_APPROVED` above). Kept in place, tested, and exported rather than removed
 * so that work has a named function to wire into instead of re-deriving `level === "autonomous"`
 * from scratch and re-litigating where that check belongs.
 */
export const canRunUnattended = (level: AutonomyLevel): boolean => level === "autonomous";
