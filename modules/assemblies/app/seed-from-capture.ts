import type { Result, AppError, JobId } from "@mallet/shared/types";
import { notFound, ok, err, asAssemblyId } from "@mallet/shared/types";
// Type-only import through the measurements barrel — erased at compile time, so
// unit tests never evaluate the barrel's router/config chain (the same seam
// build-from-measurements.ts uses).
import type { SiteQuantitiesReader, SiteQuantitiesForJob } from "@mallet/measurements";
import type { AssemblyRepository } from "../domain/assembly-repository";
import type { AssemblyForCompute, AssemblyComputeResult } from "../domain/compute-assembly";
import { computeAssemblySeed } from "../domain/compute-assembly";
import { catalogAssemblyByKey } from "../domain/assembly-defaults";
import { parseCatalogItemId } from "./list-assemblies";

export interface SeedFromCaptureCommand {
  readonly jobId: JobId;
  /** The capture's stored name — the same row the composer panel lists. */
  readonly sourceName: string;
  /** A row uuid, or "catalog:<key>" for an untouched shipped default. */
  readonly assemblyId: string;
}

/**
 * Price one PERSISTED site capture through an assembly — the server sibling of
 * the composer's held-trace path (assembly-held-seed.ts). Both call the same
 * pure engine (computeAssemblySeed); the parity test pins them byte-identical.
 * The source label mirrors buildFromMeasurements: a pitched surface names its
 * pitch, because the area being priced is the pitch-corrected one.
 */
export class SeedFromCaptureUseCase {
  constructor(
    private readonly sites: SiteQuantitiesReader,
    private readonly repo: AssemblyRepository,
  ) {}

  async exec(cmd: SeedFromCaptureCommand): Promise<Result<AssemblyComputeResult, AppError>> {
    const assembly = await this.resolveAssembly(cmd.assemblyId);
    if (!assembly.ok) return err(assembly.error);

    const sites = await this.sites.readForJob(cmd.jobId);
    const wanted = cmd.sourceName.trim();
    const site = sites.find((s) => s.name.trim() === wanted) ?? null;
    if (site === null) return err(notFound("measured surface"));

    return computeAssemblySeed(assembly.value, {
      areaSqft: site.areaSqft,
      perimeterLnft: site.perimeterLnft,
      surface: site.surface,
      // Reader-derived from the stored polygon (the same shared edge math the
      // held-trace path uses) — the structural assignment is the parity check.
      edges: site.edges,
      complexity: site.complexity,
      sourceName: siteSourceName(site),
    });
  }

  private async resolveAssembly(id: string): Promise<Result<AssemblyForCompute, AppError>> {
    const catalogKey = parseCatalogItemId(id);
    if (catalogKey !== null) {
      // Prefer the org's override when one exists (the client's catalog id may
      // be stale); a tombstoned override means the org REMOVED this default —
      // refuse rather than price a scope that isn't on the book.
      const row = await this.repo.findByCatalogKey(catalogKey);
      if (row !== null && row.deletedAt !== null) return err(notFound("assembly"));
      if (row !== null) return ok(toCompute(row.assembly.props));
      const entry = catalogAssemblyByKey(catalogKey);
      if (!entry) return err(notFound("assembly"));
      return ok({
        name: entry.name,
        measurementBasis: entry.measurementBasis,
        pricingMode: entry.pricingMode,
        marginBps: entry.marginBps,
        jobMinimumCents: entry.jobMinimumCents,
        config: entry.config,
      });
    }
    const row = await this.repo.findById(asAssemblyId(id));
    if (!row) return err(notFound("assembly"));
    return ok(toCompute(row.props));
  }
}

const toCompute = (p: {
  name: string;
  measurementBasis: AssemblyForCompute["measurementBasis"];
  pricingMode: AssemblyForCompute["pricingMode"];
  marginBps: number;
  jobMinimumCents: number;
  config: AssemblyForCompute["config"];
}): AssemblyForCompute => ({
  name: p.name,
  measurementBasis: p.measurementBasis,
  pricingMode: p.pricingMode,
  marginBps: p.marginBps,
  jobMinimumCents: p.jobMinimumCents,
  config: p.config,
});

/** Pitched surfaces name their pitch — the quantity is the corrected area. */
const siteSourceName = (site: SiteQuantitiesForJob): string =>
  site.surface === "pitched" && site.pitchRise !== null
    ? `${site.name} at ${site.pitchRise}/12`
    : site.name;
