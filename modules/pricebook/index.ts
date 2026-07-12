// Public surface for the pricebook module — the only sanctioned import seam.
export { createPricebookRouter } from "./api/pricebook-router";
export type { Service, ServiceProps } from "./domain/service";
export type { ServiceRepository } from "./domain/service-repository";
export type { Category, CategoryProps } from "./domain/category";
export type { CategoryRepository } from "./domain/category-repository";
export { CreateServiceUseCase } from "./app/create-service";
export { UpdateServiceUseCase } from "./app/update-service";
export { ArchiveServiceUseCase } from "./app/archive-service";
export { ListServicesUseCase } from "./app/list-services";
export { CreateCategoryUseCase } from "./app/create-category";
export { ListCategoriesUseCase } from "./app/list-categories";
export { SeedPricebookUseCase } from "./app/seed-pricebook";
export type { SeedPricebookInput, SeedPricebookResult } from "./app/seed-pricebook";
export { DrizzleServiceRepository } from "./infra/drizzle-service-repository";
export { DrizzleCategoryRepository } from "./infra/drizzle-category-repository";
