/**
 * lib/measure/aerial-geometry.ts
 * Pure math, formatting, and naming for the aerial tracer (site captures).
 * No Google Maps types here — everything is unit-testable. The map-facing
 * measurement calls (spherical.computeArea/computeLength) live in
 * features/measurements/aerial/map-measure.ts; this module owns unit
 * conversion, pitch math, display strings, and default surface names.
 */

// Exact conversion factors (1 ft = 0.3048 m by definition).
export const FEET_PER_METER = 1 / 0.3048;
export const SQFT_PER_SQ_METER = FEET_PER_METER * FEET_PER_METER;

export const MIN_PITCH_RISE = 1;
export const MAX_PITCH_RISE = 24;

/** Common roof pitches offered as one-tap presets; anything else goes through Custom. */
export const PITCH_PRESETS: readonly number[] = [4, 6, 8, 10];

export function sqMetersToSqft(sqMeters: number): number {
  return sqMeters * SQFT_PER_SQ_METER;
}

export function metersToFeet(meters: number): number {
  return meters * FEET_PER_METER;
}

/** Round to 2dp — matches the server's numeric(12,2) columns. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "6/12" — rise per 12 inches of run, the trade's pitch notation. */
export function pitchLabel(rise: number): string {
  return `${rise}/12`;
}

/**
 * Client-side PREVIEW of the server's slope correction (same formula as
 * modules/measurements/domain/site-capture.ts#pitchCorrectedArea). The saved
 * number always comes back from the server — this exists so the tracer can
 * show the roof area while the user is still choosing a pitch.
 */
export function pitchCorrectedAreaPreview(footprintSqft: number, pitchRise: number): number {
  return round2(footprintSqft / Math.cos(Math.atan(pitchRise / 12)));
}

export function formatSqft(sqft: number): string {
  return `${Math.round(sqft).toLocaleString("en-US")} sqft`;
}

export function formatLnft(lnft: number): string {
  return `${Math.round(lnft).toLocaleString("en-US")} lnft`;
}

export interface SurfaceSummaryInput {
  readonly surface: "flat" | "pitched";
  readonly pitchRise: number | null;
  readonly areaSqft: number;
  readonly footprintSqft: number | null;
}

/**
 * One-line summary for a saved surface:
 *   flat    → "1,240 sqft"
 *   pitched → "Footprint 1,240 sqft · Roof area 1,433 sqft at 6/12"
 * A pitched surface missing its footprint (manual entry) falls back to the
 * working area alone — never fabricate a footprint.
 */
export function surfaceSummary(s: SurfaceSummaryInput): string {
  if (s.surface === "pitched" && s.pitchRise !== null && s.footprintSqft !== null) {
    return `Footprint ${formatSqft(s.footprintSqft)} · Roof area ${formatSqft(s.areaSqft)} at ${pitchLabel(s.pitchRise)}`;
  }
  return formatSqft(s.areaSqft);
}

/**
 * Default name for a new trace: the lowest "Surface N" not already taken on
 * this job (case-insensitive, trimmed). "Surface 1", then "Surface 2", …
 */
export function nextSurfaceName(existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`surface ${n}`)) n += 1;
  return `Surface ${n}`;
}

/** Parses custom pitch input: a whole rise-per-12 between 1 and 24. */
export function parsePitchInput(
  raw: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(n)) {
    return { ok: false, error: "Enter the rise per 12 — a whole number like 6." };
  }
  if (!Number.isInteger(n) || n < MIN_PITCH_RISE || n > MAX_PITCH_RISE) {
    return {
      ok: false,
      error: `Pitch is a whole rise per 12, between ${MIN_PITCH_RISE} and ${MAX_PITCH_RISE}.`,
    };
  }
  return { ok: true, value: n };
}
