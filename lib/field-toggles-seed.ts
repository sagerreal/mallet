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

export interface FieldTogglesSeed {
  readonly measurement: MeasurementGate;
  readonly canText: CanTextSeed;
}
