// PURE certification-gate logic — NO I/O, NO DB, NO infra imports.
// Client-bundle-safe: this file is imported by server modules (modules/**) and client
// components (features/**, components/**) alike. The @mallet/shared/* path alias in
// tsconfig.json resolves shared/* from any import site, so callers use:
//   import { meetsRequirement } from "@mallet/shared/dispatch/skill-gate"
//
// Normalization contract: trim + casefold (lowercase). Every cert comparison in the
// entire skill-dispatch feature flows through this single seam — never compare raw strings.

/** trim + casefold — the ONLY normalization used for cert comparison anywhere in the app. */
export function normCert(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * True when the tech qualifies for the job's cert requirement.
 *
 * - null / undefined / [] required → no requirement → always true.
 * - Otherwise: every required cert (normalized) must appear in techCerts (normalized).
 */
export function meetsRequirement(
  techCerts: readonly string[],
  required: readonly string[] | null | undefined,
): boolean {
  // No requirement at all → all techs qualify.
  if (required == null || required.length === 0) return true;

  // Build a normalized set of what the tech holds for O(1) lookups.
  const held = new Set(techCerts.map(normCert));

  // Every required cert must be present in the held set.
  return required.every((cert) => held.has(normCert(cert)));
}

/**
 * The display-cased required entries the tech lacks.
 *
 * Returns [] when the tech is qualified, there is no requirement, or
 * required is null/undefined/[]. The display casing comes from the REQUIRED
 * side (that is what the UI prints to the user — not the tech's stored form).
 */
export function missingCerts(
  techCerts: readonly string[],
  required: readonly string[] | null | undefined,
): string[] {
  // No requirement → nothing is missing.
  if (required == null || required.length === 0) return [];

  // Build a normalized set of what the tech holds for O(1) lookups.
  const held = new Set(techCerts.map(normCert));

  // Collect required entries the tech lacks, preserving the required side's display casing.
  return required.filter((cert) => !held.has(normCert(cert)));
}

/**
 * Resolve the cert requirement for a booking-playbook service by name.
 *
 * Performs a normalized (trim + casefold) name lookup against the provided services
 * catalogue. Returns the matched entry's requiredCerts as a FRESH array, or null when:
 *   - text is null / undefined / blank
 *   - no service name matches (normalized)
 *   - the matched entry has no requiredCerts (undefined)
 *   - the matched entry's requiredCerts is empty ([] means no requirement)
 */
export function resolveServiceRequirement(
  services: readonly { name: string; requiredCerts?: readonly string[] }[],
  text: string | null | undefined,
): string[] | null {
  // Guard: no text to look up.
  if (text == null || text.trim() === "") return null;

  const normalizedText = normCert(text);

  // Find the first service whose normalized name equals the normalized text.
  const match = services.find((svc) => normCert(svc.name) === normalizedText);

  // No match, or the matched entry has no meaningful cert requirement.
  if (match === undefined) return null;
  if (match.requiredCerts === undefined || match.requiredCerts.length === 0) return null;

  // Return a fresh array — never hand the caller a reference into the services catalogue.
  return [...match.requiredCerts];
}
