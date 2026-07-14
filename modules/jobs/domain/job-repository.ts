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
  /** Job-level assignee only (the office list's filter). */
  readonly assigneeUserId?: UserId;
  /**
   * Visit-aware assignment (the field surface's filter): job-level assignee OR the
   * assignee of any active (non-canceled) visit — the SQL twin of Job.isAssignedTo,
   * so a tech can SEE every job they are authorized to act on.
   */
  readonly assignedUserId?: UserId;
}

/** The four execution child collections of one job. */
export interface JobExecution {
  lines: JobLine[];
  addons: JobAddon[];
  verifyAnswers: JobVerifyAnswer[];
  photos: JobPhoto[];
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
  // Cascade: soft-delete a lead's ACTIVE jobs (status scheduled/in_progress) and their visits when
  // the customer is archived. Terminal jobs (complete/canceled) are preserved as history — mirrors
  // the estimate cascade preserving accepted quotes. Returns the number of jobs archived.
  archiveByLead(leadId: LeadId, now: Date): Promise<number>;
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
  listExecution(jobId: JobId): Promise<JobExecution>;
  // Batched variant for list surfaces (myDay): loads every job's execution in 4 IN-clause
  // queries instead of 4 per job. Jobs with no execution rows map to empty collections.
  listExecutionForJobs(jobIds: readonly JobId[]): Promise<Map<string, JobExecution>>;
  addLine(line: JobLine, now: Date): Promise<void>;
  updateLine(line: JobLine, now: Date): Promise<number>; // rows affected; 0 = not found
  removeLine(jobId: JobId, lineId: string, now: Date): Promise<number>;
  // Bulk-replace: soft-delete the job's current lines and insert the given set (both in the
  // tenant tx, so a failure rolls back the whole swap). Powers on-site pricing which builds a
  // complete line set in one shot rather than diffing add/update/remove.
  replaceLines(jobId: JobId, lines: readonly JobLine[], now: Date): Promise<void>;
  addAddon(addon: JobAddon, now: Date): Promise<void>;
  setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number>;
  setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number>;
  upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void>;
  removeVerifyAnswer(jobId: JobId, itemId: string): Promise<number>;
  addPhoto(photo: JobPhoto, now: Date): Promise<void>;
  removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number>;
}
