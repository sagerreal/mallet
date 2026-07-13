import type { ServiceProps, CategoryProps } from "@mallet/pricebook";
import type { CatalogServiceContext } from "./draft-estimate";

// Pure mapping — active services only, category id resolved to its display name. Takes plain
// `.props` data (not the domain classes, and not the Drizzle repos) so it has no DB dependency
// and is unit-testable with plain fixtures. The DB-touching composition (fetching the props via
// the pricebook repos) lives in ../infra/catalog-context.ts.
export const toCatalogContext = (
  services: readonly ServiceProps[],
  categories: readonly CategoryProps[],
): CatalogServiceContext[] => {
  const categoryNameById = new Map<string, string>(categories.map((c) => [c.id as string, c.name]));
  return services
    .filter((s) => s.active)
    .map((s) => ({
      name: s.name,
      unitPriceCents: s.unitPriceCents,
      category: s.categoryId ? (categoryNameById.get(s.categoryId) ?? null) : null,
      laborHours: s.laborHours,
    }));
};
