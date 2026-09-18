// Public surface for the assemblies module — the only sanctioned import seam.
export { createAssemblyRouter } from "./api/assembly-router";
export type { Assembly, AssemblyProps, MeasurementBasis, PricingMode } from "./domain/assembly";
export type { AssemblyRepository } from "./domain/assembly-repository";
export type {
  AssemblyConfig,
  AssemblyComponent,
  UnitRateTier,
} from "./domain/assembly-config";
export { parseAssemblyConfig, ASSEMBLY_CONFIG_VERSION } from "./domain/assembly-config";
export {
  computeAssemblySeed,
  type AssemblyForCompute,
  type AssemblyMeasureInput,
  type AssemblySeedLine,
  type AssemblyComputeResult,
} from "./domain/compute-assembly";
export {
  DEFAULT_ASSEMBLIES,
  catalogAssemblyByKey,
  CATALOG_VERSION,
  type CatalogAssembly,
} from "./domain/assembly-defaults";
export {
  getDialValue,
  setDialValue,
  dialDisplayValue,
  dialRawValue,
  type AssemblyDial,
  type DialFormat,
  type DialTarget,
} from "./domain/assembly-dials";
export { ListAssembliesUseCase, catalogItemId, parseCatalogItemId } from "./app/list-assemblies";
export type { AssemblyListItem, AssemblyDialView } from "./app/list-assemblies";
export { SaveDialUseCase } from "./app/save-dial";
export { CreateAssemblyUseCase } from "./app/create-assembly";
export { ArchiveAssemblyUseCase } from "./app/archive-assembly";
export { SeedFromCaptureUseCase } from "./app/seed-from-capture";
export { DrizzleAssemblyRepository } from "./infra/drizzle-assembly-repository";
