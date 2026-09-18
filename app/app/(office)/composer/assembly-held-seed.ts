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
import type { SiteEdgeTotals } from "@/lib/store/types";
import type { AssemblyView } from "@/lib/store/assemblies-mapper";
import {
  computeAssemblySeed,
  type AssemblyComputeResult,
  type AssemblyDerivedWaste,
  type AssemblySkippedComponent,
} from "@/modules/assemblies/domain/compute-assembly";
import type { ValidationError, Result } from "@mallet/shared/types";
import { heldTraceSourceName } from "./held-trace-seed";

/** The measurable shape the picker gates on — held traces and persisted site
 * rows both reduce to it. */
export interface MeasurableSurface {
  readonly areaSqft: number;
  readonly perimeterLnft: number | null;
  readonly surface: "flat" | "pitched";
  /** Classed roof linears; null when unclassified. */
  readonly edges: SiteEdgeTotals | null;
}

const anyEdgeFt = (edges: SiteEdgeTotals | null): boolean =>
  edges !== null &&
  edges.eaveFt + edges.rakeFt + edges.ridgeFt + edges.hipFt + edges.valleyFt > 0;

/**
 * Which of the org's assemblies can price this surface: the assembly's basis
 * quantity must exist on it (area assemblies need a working area; perimeter
 * assemblies need a traced perimeter — manual entries have none; line
 * assemblies need classed edges; count assemblies need nothing measured), and
 * a surface-bound recipe (config.surface) only offers on its kind — a shingle
 * reroof never prices a flat driveway. A PITCHED surface without classified
 * edges still gets the roofing recipes: their edge components seed as named
 * gaps ("Classify the roof edges…"), never silently. Inactive and
 * non-priceable entries never reach the picker.
 */
export function assembliesForSurface(
  assemblies: readonly AssemblyView[],
  surface: MeasurableSurface,
): AssemblyView[] {
  return assemblies.filter((assembly) => {
    if (!assembly.active) return false;
    if (assembly.config.surface !== undefined && assembly.config.surface !== surface.surface) {
      return false;
    }
    if (assembly.measurementBasis === "area") return surface.areaSqft > 0;
    if (assembly.measurementBasis === "perimeter") {
      return surface.perimeterLnft !== null && surface.perimeterLnft > 0;
    }
    if (assembly.measurementBasis === "line") return anyEdgeFt(surface.edges);
    return true; // count — priced from dials, nothing measured required
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
      surface: trace.surface,
      edges: trace.edges,
      complexity: trace.complexity,
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

/** Copy for components a surface couldn't feed — by WHAT is missing: edge
 * components name the fix (classify the trace); perimeter/area components name
 * the gap. One sentence per need, functional. */
export function skippedNoticeText(skipped: readonly AssemblySkippedComponent[]): string | null {
  if (skipped.length === 0) return null;
  const labelsFor = (need: AssemblySkippedComponent["need"]): string[] =>
    skipped.filter((component) => component.need === need).map((component) => component.label);
  const parts: string[] = [];
  const edges = labelsFor("edges");
  if (edges.length > 0) {
    parts.push(`Classify the roof edges on this trace to price ${listJoin(edges)}.`);
  }
  const perimeter = labelsFor("perimeter");
  if (perimeter.length > 0) {
    parts.push(`Skipped (no perimeter on this surface): ${perimeter.join(", ")}.`);
  }
  const area = labelsFor("area");
  if (area.length > 0) {
    parts.push(`Skipped (no measured area on this surface): ${area.join(", ")}.`);
  }
  return parts.join(" ");
}

/** Copy for the derived-waste note — says the number, why, and where to change
 * it: "Waste 12% (hips on this roof) — change it in the Pricebook." */
export function derivedWasteNoticeText(waste: AssemblyDerivedWaste): string {
  const percent = Number.isInteger(waste.percent)
    ? String(waste.percent)
    : String(Math.round(waste.percent * 10) / 10);
  return `Waste ${percent}% (${waste.reason}) — change it in the Pricebook.`;
}

/** "ridge cap" / "ridge cap and starter strip" / "a, b and c". */
const listJoin = (labels: readonly string[]): string =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
