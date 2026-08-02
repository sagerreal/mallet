/**
 * app/(office)/composer/assembly-held-seed.ts
 *
 * Assembly seeding for traces HELD on the quote — the client sibling of the
 * server's SeedFromCaptureUseCase (modules/assemblies/app/seed-from-capture.ts).
 * There is deliberately NO math here: both paths call the ONE pure engine,
 * computeAssemblySeed (modules/assemblies/domain/compute-assembly.ts), so a
 * held trace and a persisted capture with the same geometry produce
 * byte-identical lines (proven in assembly-held-seed.test.ts, the same parity
 * contract held-trace-seed.test.ts pins for service-rate seeding).
 *
 * The store keeps assemblies in wire units (cents/bps — assemblies-mapper.ts),
 * so the AssemblyView feeds the engine without conversion; the source label
 * carries a pitched trace's pitch, mirroring the server's rule.
 */

import type { HeldTrace } from "@/lib/measure/held-trace";
import type { AssemblyView } from "@/lib/store/assemblies-mapper";
import {
  computeAssemblySeed,
  type AssemblyComputeResult,
} from "@/modules/assemblies/domain/compute-assembly";
import type { ValidationError, Result } from "@mallet/shared/types";
import { heldTraceSourceName } from "./held-trace-seed";

/**
 * Which of the org's assemblies can price this surface: the assembly's basis
 * quantity must exist on it (area assemblies need a working area; perimeter
 * assemblies need a traced perimeter — manual entries have none). line/count
 * bases never match yet (the engine refuses them; a later PR). Inactive and
 * non-priceable entries never reach the picker.
 */
export function assembliesForSurface(
  assemblies: readonly AssemblyView[],
  surface: { areaSqft: number; perimeterLnft: number | null },
): AssemblyView[] {
  return assemblies.filter((assembly) => {
    if (!assembly.active) return false;
    if (assembly.measurementBasis === "area") return surface.areaSqft > 0;
    if (assembly.measurementBasis === "perimeter") {
      return surface.perimeterLnft !== null && surface.perimeterLnft > 0;
    }
    return false;
  });
}

/** One held trace × one assembly → the engine's full result (lines in cents,
 * minimum notice, skipped-component labels). */
export function seedHeldTraceWithAssembly(
  trace: HeldTrace,
  assembly: AssemblyView,
): Result<AssemblyComputeResult, ValidationError> {
  return computeAssemblySeed(
    {
      name: assembly.name,
      measurementBasis: assembly.measurementBasis,
      pricingMode: assembly.pricingMode,
      marginBps: assembly.marginBps,
      jobMinimumCents: assembly.jobMinimumCents,
      config: assembly.config,
    },
    {
      areaSqft: trace.areaSqft,
      perimeterLnft: trace.perimeterLnft > 0 ? trace.perimeterLnft : null,
      sourceName: heldTraceSourceName(trace),
    },
  );
}

/** Copy for the in-flow minimum notice — one sentence, functional. */
export function minimumNoticeText(minimum: { minimumCents: number }): string {
  const dollars = (minimum.minimumCents / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  return `Below your $${dollars} job minimum — priced at the minimum.`;
}

/** Copy for components a surface couldn't feed (e.g. no traced perimeter). */
export function skippedNoticeText(skipped: readonly string[]): string | null {
  if (skipped.length === 0) return null;
  return `Skipped (no perimeter on this surface): ${skipped.join(", ")}.`;
}
