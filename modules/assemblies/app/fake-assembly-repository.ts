import type { AssemblyId } from "@mallet/shared/types";
import type { Assembly, AssemblyProps } from "../domain/assembly";
import { Assembly as AssemblyFactory } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";

/** In-memory repository for app-layer unit tests — mirrors the Drizzle repo's
 * contracts (tombstones included in listAll/findByCatalogKey, save resurrects). */
export class FakeAssemblyRepository implements AssemblyRepository {
  private rows = new Map<string, { props: AssemblyProps; deletedAt: Date | null }>();

  private build(props: AssemblyProps): Assembly {
    const result = AssemblyFactory.create(props);
    if (!result.ok) throw new Error(`fake repo: invalid assembly: ${result.error.message}`);
    return result.value;
  }

  async create(props: AssemblyProps): Promise<Assembly> {
    if (this.rows.has(props.id)) throw new Error("duplicate id");
    for (const row of this.rows.values()) {
      if (props.catalogKey !== null && row.props.catalogKey === props.catalogKey) {
        throw new Error("duplicate catalog key"); // the (org, catalog_key) unique
      }
    }
    this.rows.set(props.id, { props, deletedAt: null });
    return this.build(props);
  }

  async findById(id: AssemblyId): Promise<Assembly | null> {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? this.build(row.props) : null;
  }

  async findByCatalogKey(
    catalogKey: string,
  ): Promise<{ assembly: Assembly; deletedAt: Date | null } | null> {
    for (const row of this.rows.values()) {
      if (row.props.catalogKey === catalogKey) {
        return { assembly: this.build(row.props), deletedAt: row.deletedAt };
      }
    }
    return null;
  }

  async listAll(): Promise<{ assembly: Assembly; deletedAt: Date | null }[]> {
    return [...this.rows.values()]
      .sort(
        (a, b) =>
          a.props.position - b.props.position || a.props.name.localeCompare(b.props.name),
      )
      .map((row) => ({ assembly: this.build(row.props), deletedAt: row.deletedAt }));
  }

  async save(assembly: Assembly): Promise<void> {
    const row = this.rows.get(assembly.props.id);
    if (!row) throw new Error("save of unknown row");
    this.rows.set(assembly.props.id, { props: assembly.props, deletedAt: null });
  }

  async archive(id: AssemblyId, now: Date): Promise<number> {
    const row = this.rows.get(id);
    if (!row || row.deletedAt !== null) return 0;
    this.rows.set(id, { ...row, deletedAt: now });
    return 1;
  }
}
