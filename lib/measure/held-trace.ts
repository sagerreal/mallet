/**
 * lib/measure/held-trace.ts
 * A satellite trace held on the QUOTE — composer state, not the store. The
 * founder's rule: satellite measurement is an ESTIMATING feature, so the
 * tracer opens from the quote page with ZERO prerequisites (no customer, no
 * job). The DB anchors site_captures to jobs, so a trace made before any job
 * exists lives here until the quote persists against a job (?job= / ?change=
 * context); with no job it evaporates with the abandoned draft — deliberate.
 *
 * All figures are rounded to 2dp AT CAPTURE TIME (round2 — mirrors the
 * server's numeric(12,2) columns), and areaSqft uses the exact server formula
 * (pitchCorrectedArea in modules/measurements/domain/site-capture.ts):
 * footprint / cos(atan(rise/12)). Because the rounded footprint is what a
 * later siteCreate sends, the server recomputes the identical area — parity
 * is proven in held-trace-seed.test.ts against the real server use-case.
 */

import type { SitePolygonShape } from "@/lib/store/types";
import {
  formatLnft,
  pitchCorrectedAreaPreview,
  round2,
  surfaceSummary,
} from "@/lib/measure/aerial-geometry";

export interface HeldTrace {
  /** Client-authored id — becomes the site capture's id if the trace persists. */
  readonly id: string;
  readonly name: string;
  readonly surface: "flat" | "pitched";
  /** Rise per 12 for pitched surfaces; null for flat. */
  readonly pitchRise: number | null;
  readonly polygon: SitePolygonShape;
  /** Plan area as traced, 2dp — what siteCreate would send. */
  readonly footprintSqft: number;
  /** Traced edge length, 2dp. */
  readonly perimeterLnft: number;
  /** WORKING area, 2dp — pitch-corrected via the server's exact formula. */
  readonly areaSqft: number;
}

export interface CreateHeldTraceInput {
  readonly id: string;
  readonly name: string;
  readonly surface: "flat" | "pitched";
  /** Required when surface is "pitched"; ignored for flat. */
  readonly pitchRise?: number;
  readonly polygon: SitePolygonShape;
  readonly footprintSqft: number;
  readonly perimeterLnft: number;
}

/**
 * Builds a held trace from raw traced figures: rounds the inputs to the
 * server's 2dp storage precision, then derives the working area from the
 * ROUNDED footprint — so a later siteCreate (which sends that footprint)
 * yields byte-identical numbers.
 */
export function createHeldTrace(input: CreateHeldTraceInput): HeldTrace {
  const footprintSqft = round2(input.footprintSqft);
  const perimeterLnft = round2(input.perimeterLnft);
  const pitchRise = input.surface === "pitched" ? (input.pitchRise ?? null) : null;
  return {
    id: input.id,
    name: input.name,
    surface: input.surface,
    pitchRise,
    polygon: {
      vertices: input.polygon.vertices.map((v) => ({ ...v })),
      view: { ...input.polygon.view },
    },
    footprintSqft,
    perimeterLnft,
    areaSqft: pitchCorrectedAreaPreview(footprintSqft, pitchRise ?? 0),
  };
}

/** Row summary — "640 sqft · 104 lnft", pitched adds the footprint/pitch detail. */
export function heldTraceSummary(trace: HeldTrace): string {
  return `${surfaceSummary({
    surface: trace.surface,
    pitchRise: trace.pitchRise,
    areaSqft: trace.areaSqft,
    footprintSqft: trace.footprintSqft,
  })} · ${formatLnft(trace.perimeterLnft)}`;
}
