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
export type AcceptPublicQuoteResult =
  | { kind: "ok"; estimate: Estimate }
  | { kind: "invalid_selection" }
  | { kind: "invalid_tier"; reason: TierChoiceRejection }
  | { kind: "not_ready" }
  | { kind: "not_found" };

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
 */
export function classifyAcceptValidationFailure(
  current: Estimate | null,
): AcceptPublicQuoteResult {
  if (!current) return { kind: "not_found" };
  const status = current.props.status;
  if (status === "accepted" || status === "declined") {
    return { kind: "ok", estimate: current };
  }
  return { kind: "not_ready" };
}
