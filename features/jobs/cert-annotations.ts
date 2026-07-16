/**
 * features/jobs/cert-annotations.ts
 * Pure, unit-tested helper for the schedule-board skill annotation layer (T6).
 *
 * No React, no I/O, no store — takes plain arrays and returns per-tech
 * annotation data. All cert qualification logic routes through the T1 gate.
 */

import {
  meetsRequirement,
  missingCerts,
} from "@mallet/shared/dispatch/skill-gate";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface TechAnnotation {
  /** True when the tech holds every cert in `required`. */
  readonly qualified: boolean;
  /**
   * Display-cased required certs the tech is missing.
   * Empty when qualified or when there is no requirement.
   */
  readonly missing: string[];
}

export type TechLike = { id: string; skills: readonly string[] };

/**
 * Derive per-tech cert annotations for a held job's requirement.
 *
 * - required null / [] → all techs return { qualified: true, missing: [] }.
 * - Otherwise: each tech is tested via the T1 gate; unqualified techs
 *   receive the display-cased list of missing certs.
 */
export function certAnnotationsFor(
  techs: readonly TechLike[],
  required: readonly string[] | null | undefined,
): Map<string, TechAnnotation> {
  const result = new Map<string, TechAnnotation>();

  const hasReq = required != null && required.length > 0;

  for (const tc of techs) {
    if (!hasReq) {
      result.set(tc.id, { qualified: true, missing: [] });
    } else {
      const qualified = meetsRequirement(tc.skills, required);
      result.set(tc.id, {
        qualified,
        missing: qualified ? [] : missingCerts(tc.skills, required),
      });
    }
  }

  return result;
}

/**
 * Derive the armed-banner suggestion phrase for a held job.
 *
 * Returns a phrase to append to the existing banner text, or "" when there
 * is nothing to say (no requirement, or no annotation state).
 *
 * @param required     The job's requiredCerts.
 * @param techs        All techs (with id + skills).
 * @param loadOf       Pre-bound dayLoad closure for the viewed day.
 * @param techNameOf   Name lookup (id → first name).
 */
export function armedBannerPhrase(
  required: readonly string[] | null | undefined,
  techs: readonly TechLike[],
  loadOf: (id: string) => number,
  techNameOf: (id: string) => string,
): string {
  if (required == null || required.length === 0) return "";

  const certLabel = [...required].join(", ");

  const qualified = techs.filter((t) =>
    meetsRequirement(t.skills, required),
  );

  if (qualified.length === 0) {
    return ` · needs ${certLabel} — no certified crew`;
  }

  // Lightest load on the shown day; ties broken by roster order (stable sort).
  const sorted = [...qualified].sort((a, b) => loadOf(a.id) - loadOf(b.id));
  const best = sorted[0]!;
  const firstName = techNameOf(best.id).split(" ")[0];
  return ` · needs ${certLabel} — ${firstName} is certified`;
}
