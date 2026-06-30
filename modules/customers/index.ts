// Public surface for the customers module — the only sanctioned import seam (architecture rule).
export { createLeadRouter } from "./api/lead-router";
export type { Lead, LeadStage, LeadProps } from "./domain/lead";
export type { LeadRepository } from "./domain/lead-repository";
export { EnsureCustomerUseCase } from "./app/ensure-customer";
export { ListLeadsUseCase } from "./app/list-leads";
