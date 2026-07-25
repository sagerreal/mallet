import type { LeadId, CompanyId, Phone, CursorPage, Paginated } from "@mallet/shared/types";
import type { Lead, LeadStage } from "./lead";

// What a caller supplies to get-or-create a customer. The org is NEVER a parameter — it is
// implicit in the org-scoped transaction the repository is constructed with, so a caller can
// physically not address another tenant's data.
export interface EnsureCustomerInput {
  readonly name: string;
  readonly phone: Phone | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly companyId: CompanyId | null;
  readonly role: string | null;
  readonly notes: string | null;
  readonly address: string | null;
}

export interface EnsureCustomerResult {
  readonly lead: Lead;
  readonly created: boolean; // false when an existing customer (same phone) was returned
}

export interface LeadFilter {
  readonly stage?: LeadStage;
  readonly unreadOnly?: boolean;
}

export interface LeadRepository {
  // Idempotent get-or-create, deduped on (org_id, phone). Two calls with the same phone yield
  // one row. A null phone always creates (nothing to dedupe on).
  ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult>;
  findById(id: LeadId): Promise<Lead | null>;
  /** The named leads, in ONE read. The field agenda needs the customer behind every job it
   *  returns, and asking per job put an N+1 on the surface a technician reloads all day. */
  findByIds(ids: readonly LeadId[]): Promise<Lead[]>;
  list(page: CursorPage, filter?: LeadFilter): Promise<Paginated<Lead>>;
  save(lead: Lead): Promise<void>;
  // Returns the number of rows affected (0 = not found or already archived).
  archive(id: LeadId, now: Date): Promise<number>;
  // Returns the restored Lead if it was archived and is now active; null if it was already active.
  restore(id: LeadId, now: Date): Promise<Lead | null>;
}
