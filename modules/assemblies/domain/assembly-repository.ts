import type { AssemblyId } from "@mallet/shared/types";
import type { Assembly, AssemblyProps } from "./assembly";

/**
 * Persistence port for assemblies. The catalog is small (single-digit rows per
 * org — overrides + customs), so list is unpaginated by design; soft-deleted
 * rows are INCLUDED in list() because a deleted override of a catalog default
 * is a tombstone ("this org removed that default") the read-time merge must
 * see — filtering happens in list-assemblies.ts, the one consumer.
 */
export interface AssemblyRepository {
  create(props: AssemblyProps): Promise<Assembly>;
  findById(id: AssemblyId): Promise<Assembly | null>;
  /** Tombstones included — callers branch on deletedAt (resurrect vs refuse). */
  findByCatalogKey(catalogKey: string): Promise<{ assembly: Assembly; deletedAt: Date | null } | null>;
  /** All rows for the org, tombstones included (see above). */
  listAll(): Promise<{ assembly: Assembly; deletedAt: Date | null }[]>;
  save(assembly: Assembly): Promise<void>;
  /** Soft delete; returns rows affected (0 = not found / already deleted). */
  archive(id: AssemblyId, now: Date): Promise<number>;
}
