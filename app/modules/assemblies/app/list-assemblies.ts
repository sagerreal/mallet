import type { Assembly } from "../domain/assembly";
import type { AssemblyRepository } from "../domain/assembly-repository";
import type { AssemblyConfig } from "../domain/assembly-config";
import type { MeasurementBasis, PricingMode } from "../domain/assembly";
import type { AssemblyDial } from "../domain/assembly-dials";
import { getDialValue } from "../domain/assembly-dials";
import { DEFAULT_ASSEMBLIES, type CatalogAssembly } from "../domain/assembly-defaults";

/**
 * The org's assembly book, resolved at READ time: every shipped catalog entry
 * (assembly-defaults.ts) surfaces with the org's override row applied when one
 * exists — a soft-deleted override is a tombstone that HIDES its default —
 * followed by the org's custom assemblies. No rows are ever seeded; an
 * untouched org lists pure catalog (id "catalog:<key>") with zero DB rows.
 *
 * Dials ride the item with BOTH values: currentRaw (the effective constant)
 * and defaultRaw (the shipped one) — that pair is the whole per-field
 * reset-to-default story; the client never needs the catalog or the dial
 * targets. Customs carry no dials (nothing shipped to reset to).
 */

export interface AssemblyDialView {
  readonly key: string;
  readonly label: string;
  readonly format: AssemblyDial["format"];
  readonly unitSuffix: string | null;
  readonly currentRaw: number;
  readonly defaultRaw: number;
}

export interface AssemblyListItem {
  /** Override/custom rows: the row uuid. Untouched defaults: "catalog:<key>". */
  readonly id: string;
  readonly catalogKey: string | null;
  readonly name: string;
  readonly measurementBasis: MeasurementBasis;
  readonly pricingMode: PricingMode;
  readonly marginBps: number;
  readonly jobMinimumCents: number;
  readonly config: AssemblyConfig;
  readonly active: boolean;
  /** True when an org row overrides the shipped default (or the item is custom). */
  readonly isOverride: boolean;
  readonly dials: readonly AssemblyDialView[];
}

/** The synthetic id an untouched catalog default lists under. */
export const catalogItemId = (catalogKey: string): string => `catalog:${catalogKey}`;

/** Parse a client-supplied id back into its catalog key, or null for a row id. */
export const parseCatalogItemId = (id: string): string | null =>
  id.startsWith("catalog:") ? id.slice("catalog:".length) : null;

const dialViews = (
  entry: CatalogAssembly,
  effective: { marginBps: number; jobMinimumCents: number; config: AssemblyConfig },
): AssemblyDialView[] => {
  const shipped = {
    marginBps: entry.marginBps,
    jobMinimumCents: entry.jobMinimumCents,
    config: entry.config,
  };
  const views: AssemblyDialView[] = [];
  for (const dial of entry.dials) {
    const currentRaw = getDialValue(effective, dial.target);
    const defaultRaw = getDialValue(shipped, dial.target);
    // A dial that no longer resolves against an edited config is hidden, not
    // guessed at (defensive: today's editor can't produce that state).
    if (currentRaw === null || defaultRaw === null) continue;
    views.push({
      key: dial.key,
      label: dial.label,
      format: dial.format,
      unitSuffix: dial.unitSuffix ?? null,
      currentRaw,
      defaultRaw,
    });
  }
  return views;
};

const fromCatalog = (entry: CatalogAssembly): AssemblyListItem => ({
  id: catalogItemId(entry.catalogKey),
  catalogKey: entry.catalogKey,
  name: entry.name,
  measurementBasis: entry.measurementBasis,
  pricingMode: entry.pricingMode,
  marginBps: entry.marginBps,
  jobMinimumCents: entry.jobMinimumCents,
  config: entry.config,
  active: true,
  isOverride: false,
  dials: dialViews(entry, {
    marginBps: entry.marginBps,
    jobMinimumCents: entry.jobMinimumCents,
    config: entry.config,
  }),
});

const fromRow = (assembly: Assembly, entry: CatalogAssembly | null): AssemblyListItem => {
  const p = assembly.props;
  return {
    id: p.id,
    catalogKey: p.catalogKey,
    name: p.name,
    measurementBasis: p.measurementBasis,
    pricingMode: p.pricingMode,
    marginBps: p.marginBps,
    jobMinimumCents: p.jobMinimumCents,
    config: p.config,
    active: p.active,
    isOverride: true,
    dials: entry
      ? dialViews(entry, {
          marginBps: p.marginBps,
          jobMinimumCents: p.jobMinimumCents,
          config: p.config,
        })
      : [],
  };
};

export class ListAssembliesUseCase {
  constructor(private readonly repo: AssemblyRepository) {}

  async exec(): Promise<AssemblyListItem[]> {
    const rows = await this.repo.listAll();
    const overrideByKey = new Map<string, { assembly: Assembly; deletedAt: Date | null }>();
    const customs: Assembly[] = [];
    for (const row of rows) {
      const key = row.assembly.props.catalogKey;
      if (key !== null) {
        overrideByKey.set(key, row);
      } else if (row.deletedAt === null) {
        customs.push(row.assembly);
      }
    }

    const items: AssemblyListItem[] = [];
    for (const entry of DEFAULT_ASSEMBLIES) {
      const override = overrideByKey.get(entry.catalogKey);
      if (override === undefined) {
        items.push(fromCatalog(entry));
      } else if (override.deletedAt === null) {
        items.push(fromRow(override.assembly, entry));
      }
      // Tombstoned override: the org removed this default — list nothing.
    }
    for (const custom of customs) {
      items.push(fromRow(custom, null));
    }
    return items;
  }
}
