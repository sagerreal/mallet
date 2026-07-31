import type { LeadSort } from "../infra/lead-sorts";
import type { LeadView, LeadScope } from "../infra/lead-views";
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
  /** Free-text across name, phone, email and address — matched in the database, not over a page. */
  readonly search?: string;
  /** Narrow to one lead source ("Added manually", "Website form", …). */
  readonly source?: string;
  /** One Pipeline board column. See infra/lead-views.ts. */
  readonly view?: LeadView;
  /**
   * A saved worklist — owes money, no job in 12 months. A separate axis from `view`: those are the
   * board's mutually-exclusive columns, these are questions, and a customer can match both.
   */
  readonly scope?: LeadScope;
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
  /**
   * The live customer holding this number, if any. Exists so a caller can NAME the clash before
   * writing — `leads_org_phone_uidx` would otherwise raise a bare constraint violation that reaches
   * the user as "check your connection".
   */
  findByPhone(phone: Phone): Promise<Lead | null>;
  list(page: CursorPage, filter?: LeadFilter, sort?: LeadSort, sortDir?: "asc" | "desc"): Promise<Paginated<Lead>>;

  /** How many leads match the filter, ignoring pagination. Same predicates as list(). */
  count(filter?: LeadFilter): Promise<number>;

  /**
   * The filter dropdown's options and their counts, in one round trip.
   *
   * Stage is a fixed enum so its VALUES need no query — but its counts do, and a filter offering
   * "Won" on a book with no won customers wastes a click. Sources are free text and genuinely have
   * to be discovered.
   */
  /** Every Pipeline column's count in one round trip. */
  viewCounts(): Promise<Record<LeadView, number>>;

  facets(): Promise<{ stages: Record<string, number>; sources: { source: string; n: number }[] }>;
  save(lead: Lead): Promise<void>;
  // Returns the number of rows affected (0 = not found or already archived).
  archive(id: LeadId, now: Date): Promise<number>;
  // Returns the restored Lead if it was archived and is now active; null if it was already active.
  restore(id: LeadId, now: Date): Promise<Lead | null>;
}
