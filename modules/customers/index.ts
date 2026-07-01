// Public surface for the customers module — the only sanctioned import seam (architecture rule).
export { createLeadRouter } from "./api/lead-router";
export type { Lead, LeadStage, LeadProps } from "./domain/lead";
export type { LeadRepository } from "./domain/lead-repository";
export { EnsureCustomerUseCase } from "./app/ensure-customer";
export { ListLeadsUseCase } from "./app/list-leads";
// Exposed for the AI agent tool registry (constructs the repo from a tenant tx, like the router).
export { DrizzleLeadRepository } from "./infra/drizzle-lead-repository";
