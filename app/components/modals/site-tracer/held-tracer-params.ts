/**
 * components/modals/site-tracer/held-tracer-params.ts
 * Pure narrowing for the tracer's HELD-mode modal params (the composer's
 * "Measure from satellite" — no job attached, the finished trace is handed
 * back to the caller). Kept out of the modal component so the rules are
 * unit-testable without mounting store/hooks.
 *
 * The contract: `held: true` engages the mode ONLY when a real onSaveHeld
 * receiver rides along — a held tracer with no receiver would drop the trace
 * on the floor at save, a silent failure. Malformed params fall back to the
 * job-mode path (which renders its honest "no longer available" state).
 */

import type { HeldTrace } from "@/lib/measure/held-trace";

export interface HeldTracerParams {
  readonly address: string;
  readonly existingNames: readonly string[];
  readonly onSaveHeld: (trace: HeldTrace) => void;
}

export function heldTracerParams(
  params: Record<string, unknown> | undefined,
): HeldTracerParams | null {
  if (!params || params.held !== true) return null;
  if (typeof params.onSaveHeld !== "function") return null;
  const address = typeof params.address === "string" ? params.address : "";
  const existingNames = Array.isArray(params.existingNames)
    ? params.existingNames.filter((n): n is string => typeof n === "string")
    : [];
  return {
    address,
    existingNames,
    onSaveHeld: params.onSaveHeld as (trace: HeldTrace) => void,
  };
}
