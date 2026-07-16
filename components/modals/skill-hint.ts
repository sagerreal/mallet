/**
 * components/modals/skill-hint.ts
 * Pure, export-tested helper for the job-modal per-visit skill-suggestion banner.
 * All cert qualification logic delegates to the T1 gate (meetsRequirement / missingCerts).
 * No React, no I/O, no store — unit-testable with plain objects.
 */

import {
  meetsRequirement,
  missingCerts,
} from "@mallet/shared/dispatch/skill-gate";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export interface SkillHint {
  readonly state:
    | "selectedQualified"
    | "selectedMissing"
    | "noneQualified"
    | "noRequirement";
  /** What the selected tech lacks (populated for selectedMissing). */
  readonly missing: string[];
  /**
   * A DIFFERENT qualified tech with the lightest dayLoad on the visit's date.
   * Populated for selectedMissing / noneSelected paths; null otherwise.
   */
  readonly suggestedTechId: string | null;
}

export interface SkillHintInput {
  required: readonly string[] | null;
  selectedTechId: string | null;
  techs: readonly { id: string; skills: readonly string[] }[];
  /** dayLoad closure pre-bound to the visit's date. */
  loadOf: (techId: string) => number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Compute the suggest-only skill verdict for one visit row.
 *
 * Rules (all cert logic via meetsRequirement / missingCerts — zero inline compares):
 * - required null/[] → noRequirement (render nothing).
 * - Selected tech qualified → selectedQualified (no suggestion).
 * - Selected tech missing certs → selectedMissing + suggestion (the lightest
 *   QUALIFIED tech that is NOT the selected tech; if none → noneQualified).
 * - No tech selected → treat as selectedMissing with missing = required; suggest
 *   the best qualified tech; if none → noneQualified.
 * Suggestion ordering: qualified techs sorted by dayLoad ascending; ties broken by
 * roster order (index in the techs array).
 */
export function skillHintFor(input: SkillHintInput): SkillHint {
  const { required, selectedTechId, techs, loadOf } = input;

  // No requirement → nothing to show.
  if (required == null || required.length === 0) {
    return { state: "noRequirement", missing: [], suggestedTechId: null };
  }

  // Partition techs into qualified/unqualified using only the T1 gate.
  const qualifiedTechs = techs.filter((t) =>
    meetsRequirement(t.skills, required),
  );

  // If the selected tech is present and qualified → selectedQualified.
  if (selectedTechId != null) {
    const selected = techs.find((t) => t.id === selectedTechId);
    if (selected && meetsRequirement(selected.skills, required)) {
      return { state: "selectedQualified", missing: [], suggestedTechId: null };
    }
  }

  // Selected tech is missing certs (or no tech selected).
  // Compute what is missing: if no tech is selected, everything is missing.
  const selectedTech =
    selectedTechId != null
      ? techs.find((t) => t.id === selectedTechId)
      : undefined;
  const missing =
    selectedTech != null
      ? missingCerts(selectedTech.skills, required)
      : [...required];

  // Find the best suggestion: a DIFFERENT qualified tech with the lightest load.
  const candidates = qualifiedTechs.filter((t) => t.id !== selectedTechId);
  if (candidates.length === 0) {
    return { state: "noneQualified", missing, suggestedTechId: null };
  }

  // Sort by load ascending, ties by roster order (stable sort preserves original index).
  const sorted = [...candidates].sort((a, b) => loadOf(a.id) - loadOf(b.id));
  const best = sorted[0]!;

  return {
    state: "selectedMissing",
    missing,
    suggestedTechId: best.id,
  };
}
