/**
 * modules/quoting/app/public-accept-policy.ts
 *
 * Result union + failure classification for acceptPublicQuote. Lives in its own
 * file (not public-quote.ts) so unit tests can import the REAL classification
 * without pulling public-quote's infra imports — the @mallet/jobs barrel behind
 * it reaches the config validator, which throws without DB env.
 */

import type { Estimate, QuoteTier } from "../domain/estimate";

// Why a tier choice was rejected (route → 400 with per-reason copy):
//  "required"       — the estimate is tiered but the POST carried no chosenTier
//  "not_applicable" — the estimate is single-format but the POST carried a chosenTier
//  "empty_tier"     — the chosen tier has no fixed lines (not a real option)
export type TierChoiceRejection = "required" | "not_applicable" | "empty_tier";

// "invalid_selection" — a selected optional add-on id did not match a stored
//   OPTIONAL line (route → 400, "reload and try again").
// "invalid_tier" — the chosenTier failed the tier gate (see TierChoiceRejection).
// "not_ready" — the estimate exists but is not in an acceptable state and is NOT
//   terminal (e.g. a prematurely shared draft link) (route → 409).
// "invalid_signature" — the name or the drawn mark was missing or unreadable (route → 400).
//   Distinct from "not_ready" on purpose: both are domain validation failures, but telling a
//   customer whose pen slipped that "this quote isn't ready to approve" would send them to
//   the shop over a problem they could fix in two seconds.
export type AcceptPublicQuoteResult =
  | { kind: "ok"; estimate: Estimate }
  | { kind: "invalid_selection" }
  | { kind: "invalid_tier"; reason: TierChoiceRejection }
  | { kind: "invalid_signature"; message: string; field: string | null }
  | { kind: "not_ready" }
  | { kind: "not_found" };

/** Fields createSignature can reject. A validation error tagged with one of these came from the
 *  signature, not from the status guard — see classifyAcceptValidationFailure. */
export const SIGNATURE_FIELDS = new Set(["signerName", "signatureSvg", "authorizationText"]);

/**
 * Gate the customer's tier choice against the STORED estimate (never client copy).
 * A tiered estimate requires a chosenTier naming a tier with at least one fixed
 * line; a single-format estimate must not carry one. Pure — unit-testable without
 * pulling public-quote's infra imports.
 */
export function validateTierChoice(
  stored: Estimate,
  chosenTier: QuoteTier | undefined,
): { kind: "ok" } | { kind: "invalid_tier"; reason: TierChoiceRejection } {
  if (!stored.isTiered()) {
    return chosenTier ? { kind: "invalid_tier", reason: "not_applicable" } : { kind: "ok" };
  }
  if (!chosenTier) return { kind: "invalid_tier", reason: "required" };
  const hasFixedLine = stored.linesForTier(chosenTier).some((line) => !line.props.isOptional);
  if (!hasFixedLine) return { kind: "invalid_tier", reason: "empty_tier" };
  return { kind: "ok" };
}

/**
 * Classify an accept that failed domain validation, using the re-fetched estimate.
 *
 * AcceptEstimateUseCase reports every guard failure as a validation error. Only a
 * TERMINAL estimate (accepted/declined) makes that failure the idempotent
 * double-tap — return ok with current state so a re-POST keeps working. A
 * non-terminal estimate (still draft) genuinely was not accepted; reporting ok
 * would show the customer an "Approved" banner for a quote that never changed
 * state and silently drop their add-on selection.
 *
 * A signature-tagged failure is checked FIRST and never reaches the status branch. It has to be,
 * because the estimate is still "sent" in that case — exactly the shape that otherwise falls
 * through to "not_ready", which would blame the quote for a blank name box.
 */
export function classifyAcceptValidationFailure(
  current: Estimate | null,
  failure?: { readonly message: string; readonly field?: string },
): AcceptPublicQuoteResult {
  if (failure?.field && SIGNATURE_FIELDS.has(failure.field)) {
    // Checked before `current` is even consulted: the estimate is irrelevant here, and a token
    // that resolved a moment ago is not suddenly missing.
    return { kind: "invalid_signature", message: failure.message, field: failure.field };
  }
  if (!current) return { kind: "not_found" };
  const status = current.props.status;
  if (status === "accepted" || status === "declined") {
    return { kind: "ok", estimate: current };
  }
  return { kind: "not_ready" };
}
