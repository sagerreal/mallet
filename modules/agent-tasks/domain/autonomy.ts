import type { RiskTier } from "@mallet/ai";

/**
 * modules/agent-tasks/domain/autonomy.ts
 * How much the shop lets the employee do without asking. Pure, and read LIVE from org_settings
 * at approval time — never snapshotted onto a task, because a permission downgrade that does not
 * reach in-flight work is not a permission control.
 *
 * money and destructive never auto-approve at any level. Autonomous is therefore not "more
 * tiers" — it is permission to work UNATTENDED: to advance work nobody started and to open its
 * own follow-ups. Until routines and triggers exist, that is the only difference from assisted,
 * and saying so is better than inventing a level whose meaning is a removed safety rail.
 */
export const AUTONOMY_LEVELS = ["supervised", "assisted", "autonomous"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const DEFAULT_AUTONOMY: AutonomyLevel = "supervised";

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

/** May the runner advance work no human started, and may the agent open follow-up tasks? */
export const canRunUnattended = (level: AutonomyLevel): boolean => level === "autonomous";
