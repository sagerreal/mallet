import type { CompanyId, CursorPage, Paginated } from "@mallet/shared/types";
import type { Company } from "./company";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, so a caller physically cannot address another tenant's companies.
export interface CompanyRepository {
  create(input: {
    id: string;
    orgId: string;
    name: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    address: string | null;
    notes: string | null;
  }): Promise<Company>;

  findById(id: CompanyId): Promise<Company | null>;
  /**
   * Live companies whose name matches any of `names`, case-insensitively, in ONE read.
   *
   * For bulk import, which has to know whether a row is new or overwrites an existing account
   * BEFORE it writes — and must answer that for a whole chunk without an N+1. Returns every
   * match, so a caller can see when a name identifies more than one account.
   */
  findByNames(names: readonly string[]): Promise<Company[]>;

  list(page: CursorPage): Promise<Paginated<Company>>;

  save(company: Company): Promise<void>;

  // Soft-delete via deletedAt. Returns the number of rows affected (0 = not found).
  archive(id: CompanyId, now: Date): Promise<number>;
}
