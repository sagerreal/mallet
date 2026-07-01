// Public surface for the quoting module — the only sanctioned import seam (architecture rule).
export { createEstimateRouter } from "./api/estimate-router";
export type { Estimate, EstimateStatus, EstimateProps, EstimateLine } from "./domain/estimate";
export type { EstimateRepository } from "./domain/estimate-repository";
export { DraftEstimateUseCase } from "./app/draft-estimate";
export { SendEstimateUseCase } from "./app/send-estimate";
export { AcceptEstimateUseCase } from "./app/accept-estimate";
export { DeclineEstimateUseCase } from "./app/decline-estimate";
export { ListEstimatesUseCase } from "./app/list-estimates";
