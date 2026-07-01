import type {
  JobId,
  LeadId,
  EstimateId,
  UserId,
  CursorPage,
  Paginated,
} from "@mallet/shared/types";
import type { Job, JobStatus } from "./job";

export interface JobFilter {
  readonly status?: JobStatus;
  readonly assigneeUserId?: UserId;
}

export interface JobRepository {
  // Allocate the next gapless per-org job number ("JOB-<n>") inside the caller's tx.
  nextNumber(): Promise<string>;
  save(job: Job): Promise<void>;
  // Idempotent create keyed on the source estimate. Returns true if inserted, false if an active
  // job for that estimate already exists (ON CONFLICT DO NOTHING — safe inside the request's tx).
  insertForEstimate(job: Job): Promise<boolean>;
  findById(id: JobId): Promise<Job | null>;
  // Underpins createFromEstimate idempotency (one active job per accepted estimate).
  findBySourceEstimate(estimateId: EstimateId): Promise<Job | null>;
  list(page: CursorPage, filter?: JobFilter): Promise<Paginated<Job>>;
  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Job>>;
}
