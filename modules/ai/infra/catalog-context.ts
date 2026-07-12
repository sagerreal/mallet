import { toPage, type OrgId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  ListServicesUseCase,
  DrizzleServiceRepository,
  ListCategoriesUseCase,
  DrizzleCategoryRepository,
} from "@mallet/pricebook";
import type { CatalogServiceContext } from "../app/draft-estimate";
import { toCatalogContext } from "../app/catalog-context";

// Bounded top-N of the org's real pricebook, read inside the caller's short-lived withTenant
// tx. Retrieval only — a single paginated `list` query (never an unbounded dump) plus the
// category tree (one query, no N+1, per ListCategoriesUseCase's contract). The pure mapping
// (active-filter, category-name resolution) lives in ../app/catalog-context.ts.
const CATALOG_CONTEXT_LIMIT = 100;

export const fetchCatalogContext = async (
  tx: TenantTx,
  orgId: OrgId,
): Promise<CatalogServiceContext[]> => {
  const serviceRepo = new DrizzleServiceRepository(tx, orgId);
  const categoryRepo = new DrizzleCategoryRepository(tx, orgId);

  const [servicePage, categories] = await Promise.all([
    new ListServicesUseCase(serviceRepo).exec({ page: toPage({ limit: CATALOG_CONTEXT_LIMIT }) }),
    new ListCategoriesUseCase(categoryRepo).exec(),
  ]);

  return toCatalogContext(
    servicePage.items.map((s) => s.props),
    categories.map((c) => c.props),
  );
};
