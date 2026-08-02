import { and, asc, eq, isNull } from "drizzle-orm";
import { assemblies } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { AssemblyId, OrgId } from "@mallet/shared/types";
import type { Assembly, AssemblyProps } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";
import { toDomain } from "./assembly-mapper";

/**
 * Real persistence. Constructed with a tenant-scoped transaction (withTenant
 * already set app.current_org_id), so RLS appends org_id = current_org_id() to
 * every statement. orgId is supplied to stamp inserts and guard writes
 * explicitly (defense-in-depth + index use), mirroring DrizzleCompanyRepository.
 */
export class DrizzleAssemblyRepository implements AssemblyRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(props: AssemblyProps): Promise<Assembly> {
    const rows = await this.tx
      .insert(assemblies)
      .values({
        id: props.id,
        orgId: this.orgId,
        catalogKey: props.catalogKey,
        name: props.name,
        measurementBasis: props.measurementBasis,
        pricingMode: props.pricingMode,
        marginBps: props.marginBps,
        jobMinimumCents: props.jobMinimumCents,
        config: props.config,
        active: props.active,
        position: props.position,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("assembly insert returned no row");
    return toDomain(row);
  }

  async findById(id: AssemblyId): Promise<Assembly | null> {
    const rows = await this.tx
      .select()
      .from(assemblies)
      .where(and(eq(assemblies.id, id), eq(assemblies.orgId, this.orgId), isNull(assemblies.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByCatalogKey(
    catalogKey: string,
  ): Promise<{ assembly: Assembly; deletedAt: Date | null } | null> {
    // Tombstones (soft-deleted overrides) are INCLUDED — save-dial must
    // resurrect one rather than trip the (org_id, catalog_key) unique, and
    // seed-from-capture must refuse one rather than price a removed scope.
    const rows = await this.tx
      .select()
      .from(assemblies)
      .where(and(eq(assemblies.catalogKey, catalogKey), eq(assemblies.orgId, this.orgId)))
      .limit(1);
    const row = rows[0];
    return row ? { assembly: toDomain(row), deletedAt: row.deletedAt } : null;
  }

  async listAll(): Promise<{ assembly: Assembly; deletedAt: Date | null }[]> {
    // Tombstones included by contract (see the port) — the read-time catalog
    // merge needs "org removed this default" as a fact, not an absence.
    const rows = await this.tx
      .select()
      .from(assemblies)
      .where(eq(assemblies.orgId, this.orgId))
      .orderBy(asc(assemblies.position), asc(assemblies.name), asc(assemblies.id));
    return rows.map((row) => ({ assembly: toDomain(row), deletedAt: row.deletedAt }));
  }

  async save(assembly: Assembly): Promise<void> {
    const p = assembly.props;
    await this.tx
      .update(assemblies)
      .set({
        name: p.name,
        marginBps: p.marginBps,
        jobMinimumCents: p.jobMinimumCents,
        config: p.config,
        active: p.active,
        position: p.position,
        updatedAt: p.updatedAt,
        // save() also resurrects a tombstoned override (restore-to-book).
        deletedAt: null,
      })
      .where(and(eq(assemblies.id, p.id), eq(assemblies.orgId, this.orgId)));
  }

  async archive(id: AssemblyId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(assemblies)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(assemblies.id, id), eq(assemblies.orgId, this.orgId), isNull(assemblies.deletedAt)))
      .returning();
    return rows.length;
  }
}
