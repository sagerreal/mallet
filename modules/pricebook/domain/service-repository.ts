import type { CursorPage, Paginated, ServiceId } from "@mallet/shared/types";
import type { Service, ServicePricedBy } from "./service";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's services.
export interface ServiceRepository {
  create(input: {
    id: string;
    orgId: string;
    categoryId: string | null;
    code: string | null;
    name: string;
    description: string | null;
    unitPriceCents: number;
    costCents: number;
    laborHours: number | null;
    taxable: boolean;
    warrantyText: string | null;
    imageUrl: string | null;
    isAddon: boolean;
    active: boolean;
    position: number;
    measuredBy: ServicePricedBy | null;
  }): Promise<Service>;

  findById(id: ServiceId): Promise<Service | null>;

  list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>>;
  /**
   * Every live service name, unpaginated. For the import confirm step, which has to tell a shop
   * how many rows will OVERWRITE an existing service before it writes any of them. Names only —
   * the question is answered by string comparison, and the full DTO for a large book is a lot of
   * payload for that.
   */
  allNames(): Promise<string[]>;

  save(service: Service): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  archive(id: ServiceId, now: Date): Promise<number>;
}
