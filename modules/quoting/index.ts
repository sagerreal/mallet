// Public surface for the quoting module — the only sanctioned import seam (architecture rule).
export { createEstimateRouter } from "./api/estimate-router";
export type { Estimate, EstimateStatus, EstimateProps, EstimateLine } from "./domain/estimate";
export { QUOTE_TIERS, isQuoteTier } from "./domain/estimate";
export type { QuoteTier, TierNames, TierTotals } from "./domain/estimate";
export type { EstimateRepository } from "./domain/estimate-repository";
// Exposed so other modules (e.g. jobs) can read estimates through this seam without touching
// quoting internals.
export { DrizzleEstimateRepository } from "./infra/drizzle-estimate-repository";
export { DraftEstimateUseCase } from "./app/draft-estimate";
export { SendEstimateUseCase } from "./app/send-estimate";
export { AcceptEstimateUseCase } from "./app/accept-estimate";
export { DeclineEstimateUseCase } from "./app/decline-estimate";
export { ListEstimatesUseCase } from "./app/list-estimates";
// Public (unauthenticated) quote functions — used by the customer-facing quote page routes.
export { getPublicQuote, acceptPublicQuote, declinePublicQuote } from "./app/public-quote";
export type { PublicQuoteView } from "./app/public-quote";
// The estimator's learned rules — modules/ai reads confirmed rules through this seam.
export { QuotingRule } from "./domain/quoting-rule";
export type { QuotingRuleProps, QuotingRuleStatus, QuotingRuleSource } from "./domain/quoting-rule";
export type { QuotingRuleRepository } from "./domain/quoting-rule-repository";
export type { RuleCandidate } from "./domain/rule-match";
export { DrizzleQuotingRuleRepository } from "./infra/drizzle-quoting-rule-repository";
// Non-fatal savepoint isolation for the accept path: a failed job creation must not roll back a
// successful acceptance. Shared so the agent tool and the office route cannot drift apart.
export { runInSavepoint } from "./api/savepoint";
// Signature evidence on an accepted quote: who signed, and a frozen copy of exactly what they
// signed. coveredBySignature answers whether a final invoice still falls under it.
export { createSignature, coveredBySignature } from "./domain/signature";
export type { Signature, SignedSnapshot, SignedLine } from "./domain/signature";
