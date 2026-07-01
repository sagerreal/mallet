import type { EstimateId, LeadId, CursorPage, Paginated } from "@mallet/shared/types";
import type { Estimate, EstimateStatus } from "./estimate";

export interface EstimateFilter {
  readonly status?: EstimateStatus;
}

export interface EstimateRepository {
  // Allocate the next gapless per-org estimate number ("EST-<n>"), inside the caller's tx.
  nextNumber(): Promise<string>;
  // Upsert the header AND diff its lines (insert new / update changed / soft-delete removed) in
  // one tx. org_id is never a parameter — it is implicit in the tenant-scoped tx.
  save(estimate: Estimate): Promise<void>;
  // Load the aggregate with its lines via a single JOIN (no N+1). Null if absent/soft-deleted.
  findById(id: EstimateId): Promise<Estimate | null>;
  list(page: CursorPage, filter?: EstimateFilter): Promise<Paginated<Estimate>>;
  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>>;
}
