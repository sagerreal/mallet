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
// The field-sale recorder — v1.field.signQuote (jobs module) writes the accepted on-site
// estimate through this seam, in the same tenant tx as the job's own line/signature write.
export { RecordFieldSaleUseCase } from "./app/record-field-sale";
export type { RecordFieldSaleCommand, FieldSaleOutcome, FieldSaleLineInput } from "./app/record-field-sale";
// The signed-addendum recorder — the jobs module's found-work approval writes the customer's
// signature through this seam as a change-order estimate, in the same tenant tx as the add-on
// status flip and the job-line append.
export { RecordChangeOrderUseCase } from "./app/record-change-order";
export type { RecordChangeOrderCommand, ChangeOrderLineInput } from "./app/record-change-order";
export type { EstimateOrigin } from "./domain/estimate";
export { isEstimateOrigin } from "./domain/estimate";
// Public (unauthenticated) quote functions — used by the customer-facing quote page routes.
export { getPublicQuote, acceptPublicQuote, declinePublicQuote } from "./app/public-quote";
export type { PublicQuoteView } from "./app/public-quote";
// Quote deposits. createPublicDepositCheckout is the customer-facing mint; recordEstimateDeposit
// is the recorder BOTH Stripe entry points call (the webhook route and the /pay/success reconcile),
// so the two can never drift into recording a deposit differently.
export { createPublicDepositCheckout, recordEstimateDeposit } from "./app/public-quote-deposit";
export type { PublicDepositCheckoutOutcome } from "./app/public-quote-deposit";
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
export type { SignatureDraft } from "./domain/signature";
// The authorisation sentence is exported so the FIELD signing path renders and stores the same
// words as the web one. Two copies of this sentence would be two different agreements.
export { authorizationText, AUTHORIZATION_VERSION } from "./domain/authorization-text";
export type { Signature, SignedSnapshot, SignedLine } from "./domain/signature";
