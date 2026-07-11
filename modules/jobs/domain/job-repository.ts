import type {
  JobId,
  LeadId,
  EstimateId,
  UserId,
  CursorPage,
  Paginated,
} from "@mallet/shared/types";
import type { Job, JobStatus } from "./job";
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "./job-execution";

export interface JobFilter {
  readonly status?: JobStatus;
  readonly assigneeUserId?: UserId;
}

export interface JobRepository {
  // Allocate the next gapless per-org job number ("JOB-<n>") inside the caller's tx.
  nextNumber(): Promise<string>;
  save(job: Job): Promise<void>;
  // Plain insert for a manually-created (non-estimate) job. Distinct from insertForEstimate:
  // no ON CONFLICT DO NOTHING keyed on estimate — caller owns the id and idempotency.
  insertManual(job: Job): Promise<void>;
  // Soft-delete a job. Returns the number of rows affected (0 = not found / already archived).
  archive(id: JobId, now: Date): Promise<number>;
  // Idempotent create keyed on the source estimate. Returns true if inserted, false if an active
  // job for that estimate already exists (ON CONFLICT DO NOTHING — safe inside the request's tx).
  insertForEstimate(job: Job): Promise<boolean>;
  findById(id: JobId): Promise<Job | null>;
  // Underpins createFromEstimate idempotency (one active job per accepted estimate).
  findBySourceEstimate(estimateId: EstimateId): Promise<Job | null>;
  list(page: CursorPage, filter?: JobFilter): Promise<Paginated<Job>>;
  listByLead(leadId: LeadId, page: CursorPage): Promise<Paginated<Job>>;

  // ── job execution data (Phase 5) ─────────────────────────────────────────
  // Each returns the loaded child collections for a job so a use-case can hand the router the
  // refreshed full-job DTO. All are org-implicit (the tx is tenant-scoped) and non-deleted only.
  listExecution(jobId: JobId): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }>;
  addLine(line: JobLine, now: Date): Promise<void>;
  updateLine(line: JobLine, now: Date): Promise<number>; // rows affected; 0 = not found
  removeLine(jobId: JobId, lineId: string, now: Date): Promise<number>;
  addAddon(addon: JobAddon, now: Date): Promise<void>;
  setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number>;
  setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number>;
  upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void>;
  removeVerifyAnswer(jobId: JobId, itemId: number): Promise<number>;
  addPhoto(photo: JobPhoto, now: Date): Promise<void>;
  removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number>;
}
