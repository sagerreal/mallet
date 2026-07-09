// Public surface for the companies module — the only sanctioned import seam.
export { createCompanyRouter } from "./api/company-router";
export type { Company, CompanyProps } from "./domain/company";
export type { CompanyRepository } from "./domain/company-repository";
export { CreateCompanyUseCase } from "./app/create-company";
export { ListCompaniesUseCase } from "./app/list-companies";
export { UpdateCompanyUseCase } from "./app/update-company";
export { ArchiveCompanyUseCase } from "./app/archive-company";
export { DrizzleCompanyRepository } from "./infra/drizzle-company-repository";
