import type { Result, AppError, Clock, OrgId } from "@mallet/shared/types";
import { notFound, ok, err, asAssemblyId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { Assembly } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";
import { catalogAssemblyByKey } from "../domain/assembly-defaults";
import { parseCatalogItemId } from "./list-assemblies";

export interface ArchiveAssemblyCommand {
  /** A row uuid, or "catalog:<key>" for an untouched shipped default. */
  readonly assemblyId: string;
}

/**
 * Remove an assembly from the org's book. Rows soft-delete; removing an
 * UNTOUCHED catalog default first materializes its override row and tombstones
 * it in the same transaction — the tombstone is the durable "this org removed
 * that default" fact the read-time merge honors (and a later edit resurrects).
 */
export class ArchiveAssemblyUseCase {
  constructor(
    private readonly repo: AssemblyRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ArchiveAssemblyCommand, orgId: OrgId): Promise<Result<{ ok: true }, AppError>> {
    const now = this.clock.now();
    const catalogKey = parseCatalogItemId(cmd.assemblyId);

    if (catalogKey === null) {
      const archived = await this.repo.archive(asAssemblyId(cmd.assemblyId), now);
      if (archived === 0) return err(notFound("assembly"));
      return ok({ ok: true });
    }

    const entry = catalogAssemblyByKey(catalogKey);
    if (!entry) return err(notFound("assembly"));
    // Client raced an override into existence? Archive the row instead
    // (an already-tombstoned row reports notFound — nothing left to remove).
    const existing = await this.repo.findByCatalogKey(catalogKey);
    if (existing) {
      const archived = await this.repo.archive(existing.assembly.props.id, now);
      if (archived === 0) return err(notFound("assembly"));
      return ok({ ok: true });
    }
    const created = Assembly.create({
      id: asAssemblyId(this.ids.newId()),
      orgId,
      catalogKey: entry.catalogKey,
      name: entry.name,
      measurementBasis: entry.measurementBasis,
      pricingMode: entry.pricingMode,
      marginBps: entry.marginBps,
      jobMinimumCents: entry.jobMinimumCents,
      config: entry.config,
      active: true,
      position: entry.position,
      createdAt: now,
      updatedAt: now,
    });
    if (!created.ok) return err(created.error);
    const row = await this.repo.create(created.value.props);
    const archived = await this.repo.archive(row.props.id, now);
    if (archived === 0) return err(notFound("assembly"));
    return ok({ ok: true });
  }
}
