import type { Estimate, EstimateLine, QuoteTier } from "../domain/estimate";
import type { AcceptLineInput } from "./accept-estimate";

/**
 * Builds the accept-time line set from a customer's optional add-on selection.
 *
 * SECURITY-CRITICAL: the public quote route accepts only an ID SUBSET from the
 * (unauthenticated) token holder — never client-authored line content. Every
 * committed line here is built FROM THE STORED ESTIMATE's lines, preserving the
 * stored description/quantity/rate/cost/needsPhoto, so a token holder can toggle
 * add-ons on/off but can never rewrite prices.
 *
 * Result kinds (discriminated union, same convention as public-quote.ts):
 *  - "none"    — nothing selected → the caller must omit cmd.lines entirely
 *  - "invalid" — a selected id is unknown or names a non-optional line
 *  - "lines"   — all fixed lines + the selected optional lines flipped to
 *                isOptional:false, in stored order (unselected add-ons drop off)
 */
export type AcceptLineSelection =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "lines"; lines: readonly AcceptLineInput[] };

const toAcceptLineInput = (line: EstimateLine): AcceptLineInput => {
  const lp = line.props;
  return {
    description: lp.description,
    quantity: lp.quantity,
    rateCents: lp.rate,
    costCents: lp.cost,
    isOptional: false,
    needsPhoto: lp.needsPhoto,
  };
};

export function buildAcceptLinesFromSelection(
  estimate: Estimate,
  selectedOptionalLineIds: readonly string[] | undefined,
): AcceptLineSelection {
  if (!selectedOptionalLineIds || selectedOptionalLineIds.length === 0) {
    return { kind: "none" };
  }

  const optionalIds = new Set<string>(
    estimate.props.lines.filter((l) => l.props.isOptional).map((l) => l.props.id),
  );

  // Dedupe, then require every selected id to name a stored OPTIONAL line.
  const selected = new Set(selectedOptionalLineIds);
  for (const id of selected) {
    if (!optionalIds.has(id)) return { kind: "invalid" };
  }

  const lines = estimate.props.lines
    .filter((l) => !l.props.isOptional || selected.has(l.props.id))
    .map(toAcceptLineInput);

  return { kind: "lines", lines };
}

/**
 * Good/Better/Best variant: builds the committed line set for the CHOSEN tier.
 * Same security model as buildAcceptLinesFromSelection — ID subset only, every
 * committed line built from the STORED estimate — plus tier scoping: the selection
 * may only name OPTIONAL lines of the chosen tier (an id from another tier is
 * invalid). The committed set is the chosen tier's fixed lines + the selected
 * optionals flipped non-optional; other tiers' lines drop off. Always returns
 * "lines" on success (the line set MUST be replaced to resolve a tiered estimate),
 * never "none". The committed AcceptLineInputs carry no tier — the accepted
 * estimate is a resolved single quote.
 */
export function buildAcceptLinesForTier(
  estimate: Estimate,
  chosenTier: QuoteTier,
  selectedOptionalLineIds: readonly string[] | undefined,
): AcceptLineSelection {
  const tierLines = estimate.linesForTier(chosenTier);
  const optionalIds = new Set<string>(
    tierLines.filter((l) => l.props.isOptional).map((l) => l.props.id),
  );

  // Dedupe, then require every selected id to name an OPTIONAL line of the CHOSEN tier.
  const selected = new Set(selectedOptionalLineIds ?? []);
  for (const id of selected) {
    if (!optionalIds.has(id)) return { kind: "invalid" };
  }

  const lines = tierLines
    .filter((l) => !l.props.isOptional || selected.has(l.props.id))
    .map(toAcceptLineInput);

  return { kind: "lines", lines };
}
