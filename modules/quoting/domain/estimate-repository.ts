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
  // Soft-delete (archive) an estimate by setting deleted_at. Returns the number of rows affected
  // (0 = not found or already archived). Single UPDATE + RETURNING — no prior findById needed.
  archive(id: EstimateId, now: Date): Promise<number>;
  // Clear deleted_at on a soft-deleted estimate (restore). Returns the restored aggregate, or null
  // if the estimate was not currently archived (already active or does not exist).
  restore(id: EstimateId, now: Date): Promise<Estimate | null>;
  // Soft-delete all non-archived estimates for a lead. Returns the number of affected rows.
  // Called when a lead is archived. Does NOT cascade on restore — an unarchived customer's
  // quotes stay archived; the office re-sends if needed.
  archiveByLead(leadId: LeadId, now: Date): Promise<number>;
}
