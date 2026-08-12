import type { CursorPage, MaterialId, Paginated } from "@mallet/shared/types";
import type { Material } from "./material";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's materials.
export interface MaterialRepository {
  create(input: {
    id: string;
    orgId: string;
    categoryId: string | null;
    code: string | null;
    name: string;
    description: string | null;
    unitCostCents: number;
    unitPriceCents: number;
    pricingMode: "rule" | "manual";
    unitOfMeasure: string;
    markupBps: number | null;
    taxable: boolean;
    vendor: string | null;
    active: boolean;
    position: number;
  }): Promise<Material>;

  findById(id: MaterialId): Promise<Material | null>;
  /**
   * Every live material name, unpaginated. For the import confirm step, which has to tell a shop
   * how many rows will OVERWRITE an existing material before it writes any of them. Names only —
   * the question is answered by string comparison. Mirrors ServiceRepository.allNames.
   */
  allNames(): Promise<string[]>;

  list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>>;

  save(material: Material): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  archive(id: MaterialId, now: Date): Promise<number>;
}

/** The org's markup-band table. Empty list = org uses DEFAULT_MARKUP_BANDS. */
export interface MarkupBandsRepository {
  list(): Promise<{ minCostCents: number; markupBps: number }[]>;
  /** Replace the whole table atomically — bands are a small ordered set, not row-CRUD. */
  replaceAll(bands: { minCostCents: number; markupBps: number }[]): Promise<void>;
}
