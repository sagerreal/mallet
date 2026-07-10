// Public surface for the quoting module — the only sanctioned import seam (architecture rule).
export { createEstimateRouter } from "./api/estimate-router";
export type { Estimate, EstimateStatus, EstimateProps, EstimateLine } from "./domain/estimate";
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
