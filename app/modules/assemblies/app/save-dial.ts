import type { Result, AppError, Clock, OrgId } from "@mallet/shared/types";
import { validation, notFound, ok, err, asAssemblyId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { Assembly } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";
import { setDialValue } from "../domain/assembly-dials";
import { catalogAssemblyByKey, type CatalogAssembly } from "../domain/assembly-defaults";
import { parseCatalogItemId } from "./list-assemblies";

export interface SaveDialCommand {
  /** A row uuid, or the "catalog:<key>" synthetic id an untouched default lists under. */
  readonly assemblyId: string;
  readonly dialKey: string;
  /** RAW value (cents / bps / factor) — dialRawValue converted it client-side;
   * the domain re-validates whatever arrives. */
  readonly rawValue: number;
}

/**
 * Turn one dial on one assembly — the pricebook editor's only write. Copy-on-
 * write: editing an untouched catalog default materializes the org's override
 * row (shipped constants + this one change); editing an existing override
 * patches it. Setting a dial back to its shipped value is how "reset" works —
 * same path, no special case (the override row simply holds catalog values
 * again). Dials only exist for catalog-backed assemblies, so a custom row
 * (no catalogKey) has nothing to save here.
 */
export class SaveDialUseCase {
  constructor(
    private readonly repo: AssemblyRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SaveDialCommand, orgId: OrgId): Promise<Result<Assembly, AppError>> {
    if (!Number.isFinite(cmd.rawValue) || cmd.rawValue < 0) {
      return err(validation("enter a number of zero or more", "rawValue"));
    }

    const resolved = await this.resolve(cmd.assemblyId);
    if (!resolved.ok) return err(resolved.error);
    const { existing, entry } = resolved.value;

    const dial = entry.dials.find((d) => d.key === cmd.dialKey);
    if (!dial) return err(notFound(`"${entry.name}" has no "${cmd.dialKey}" setting`));

    const now = this.clock.now();

    if (existing !== null) {
      const next = setDialValue(
        {
          marginBps: existing.props.marginBps,
          jobMinimumCents: existing.props.jobMinimumCents,
          config: existing.props.config,
        },
        dial.target,
        cmd.rawValue,
      );
      if (next === null) {
        return err(validation(`"${dial.label}" no longer applies to this assembly`, "dialKey"));
      }
      const patched = existing.patch(
        {
          marginBps: next.marginBps,
          jobMinimumCents: next.jobMinimumCents,
          config: next.config,
        },
        now,
      );
      if (!patched.ok) return err(patched.error);
      // save() also resurrects a tombstoned override — editing a removed
      // default puts it back on the book with the new value.
      await this.repo.save(patched.value);
      return ok(patched.value);
    }

    // No org row yet: materialize the override from the shipped constants.
    const next = setDialValue(
      { marginBps: entry.marginBps, jobMinimumCents: entry.jobMinimumCents, config: entry.config },
      dial.target,
      cmd.rawValue,
    );
    if (next === null) {
      return err(validation(`"${dial.label}" no longer applies to this assembly`, "dialKey"));
    }
    const created = Assembly.create({
      id: asAssemblyId(this.ids.newId()),
      orgId,
      catalogKey: entry.catalogKey,
      name: entry.name,
      measurementBasis: entry.measurementBasis,
      pricingMode: entry.pricingMode,
      marginBps: next.marginBps,
      jobMinimumCents: next.jobMinimumCents,
      config: next.config,
      active: true,
      position: entry.position,
      createdAt: now,
      updatedAt: now,
    });
    if (!created.ok) return err(created.error);
    return ok(await this.repo.create(created.value.props));
  }

  private async resolve(
    id: string,
  ): Promise<Result<{ existing: Assembly | null; entry: CatalogAssembly }, AppError>> {
    const catalogKey = parseCatalogItemId(id);
    if (catalogKey !== null) {
      const entry = catalogAssemblyByKey(catalogKey);
      if (!entry) return err(notFound("assembly"));
      // A concurrent edit may have materialized the override already — the
      // (org, catalog_key) unique makes racing creates fail loudly, so prefer
      // the row whenever one exists (a tombstone resurrects on save).
      const existing = await this.repo.findByCatalogKey(catalogKey);
      return ok({ existing: existing?.assembly ?? null, entry });
    }
    const existing = await this.repo.findById(asAssemblyId(id));
    if (!existing) return err(notFound("assembly"));
    const key = existing.props.catalogKey;
    const entry = key === null ? null : catalogAssemblyByKey(key);
    if (!entry) {
      return err(validation("custom assemblies have no shipped settings to edit here", "assemblyId"));
    }
    return ok({ existing, entry });
  }
}
