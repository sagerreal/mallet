import type { MeasurementGate } from "@/lib/measurement-gate";

/**
 * lib/field-toggles-seed.ts
 *
 * The shape the layouts hand to the client for the org's two field capability flags, in a module
 * neither side owns — the same split `lib/measurement-gate.ts` already uses to sit between
 * `lib/auth/server-field-toggles.ts` (server-only) and the client providers that read it. Without
 * it the client would be importing a type out of a `server-only` module, which works today only
 * because `import type` erases.
 */

/** The server's answer to "may this shop send SMS right now", or that it could not find out. */
export type CanTextSeed = "yes" | "no" | "unknown";

/**
 * The shop's overtime rule, or null when the server could not read it.
 *
 * Unlike `canText` there is no fail-open/fail-closed dilemma here: null means the reader falls
 * back to the FEDERAL floor, which is both the column's own default and the law where no state
 * rule applies — so a failed read shows the same figure a shop that never opened Settings sees,
 * rather than inventing a daily rule nobody set.
 */
export interface OvertimePolicySeed {
  readonly weeklyThresholdMinutes: number;
  readonly dailyThresholdMinutes: number | null;
}

export interface FieldTogglesSeed {
  readonly measurement: MeasurementGate;
  readonly canText: CanTextSeed;
  readonly overtime: OvertimePolicySeed | null;
}
