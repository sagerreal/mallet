/**
 * modules/quoting/app/public-accept-policy.ts
 *
 * Result union + failure classification for acceptPublicQuote. Lives in its own
 * file (not public-quote.ts) so unit tests can import the REAL classification
 * without pulling public-quote's infra imports — the @mallet/jobs barrel behind
 * it reaches the config validator, which throws without DB env.
 */

import type { Estimate } from "../domain/estimate";

// "invalid_selection" — a selected optional add-on id did not match a stored
//   OPTIONAL line (route → 400, "reload and try again").
// "not_ready" — the estimate exists but is not in an acceptable state and is NOT
//   terminal (e.g. a prematurely shared draft link) (route → 409).
export type AcceptPublicQuoteResult =
  | { kind: "ok"; estimate: Estimate }
  | { kind: "invalid_selection" }
  | { kind: "not_ready" }
  | { kind: "not_found" };

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
