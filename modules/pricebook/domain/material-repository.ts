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
    unitOfMeasure: string;
    markupBps: number | null;
    taxable: boolean;
    vendor: string | null;
    active: boolean;
    position: number;
  }): Promise<Material>;

  findById(id: MaterialId): Promise<Material | null>;

  list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>>;

  save(material: Material): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  archive(id: MaterialId, now: Date): Promise<number>;
}
