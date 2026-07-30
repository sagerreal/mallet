import type {
  JobId,
  LeadId,
  EstimateId,
  UserId,
  CursorPage,
  Paginated,
} from "@mallet/shared/types";
import type { Job, JobStatus, JobChecklistProps } from "./job";
import type { JobSort } from "../infra/job-sorts";
import type { JobSignature } from "./job-signature";
import type { JobLine, JobAddon, JobVerifyAnswer, JobPhoto, AddonStatus } from "./job-execution";

export interface AutopsyPairRow {
  readonly callback: {
    readonly id: JobId;
    readonly num: string;
    readonly svc: string | null;
    readonly completedAt: Date | null;
  };
  readonly original: {
    readonly id: JobId;
    readonly num: string;
    readonly svc: string | null;
    readonly completedAt: Date | null;
    readonly checklist: JobChecklistProps | null;
  };
}

export interface CallbackScanRow {
  readonly id: JobId;
  readonly num: string;
  readonly leadId: string;
  readonly svc: string | null;
  readonly status: string;
  readonly completedAt: Date | null;
  readonly scheduledStart: Date | null;
  readonly createdAt: Date;
  readonly callbackOf: JobId | null;
  readonly callbackReason: string | null;
}

export interface JobFilter {
  readonly status?: JobStatus;
  /**
   * Free-text search across the job's own title and number.
   *
   * Deliberately NOT a customer-name search: that needs a join to leads, which changes the keyset
   * and the index, and doing it badly is worse than not doing it. Customer search belongs with
   * the customers list until the joined version is designed properly.
   */
  readonly search?: string;
  /** Job-level assignee only (the office list's filter). */
  readonly assigneeUserId?: UserId;
  /**
   * Visit-aware assignment (the field surface's filter): job-level assignee OR the
   * assignee of any active (non-canceled) visit — the SQL twin of Job.isAssignedTo,
   * so a tech can SEE every job they are authorized to act on.
   */
  readonly assignedUserId?: UserId;
  /** Narrow to one customer's jobs. Combined with assignedUserId it answers "is this person on a
   *  job for this customer" — the question the field surface's reach is defined by. */
  readonly leadId?: LeadId;
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
  list(page: CursorPage, filter?: JobFilter, sort?: JobSort, sortDir?: "asc" | "desc"): Promise<Paginated<Job>>;

  /** How many jobs match the filter, ignoring pagination. Same predicates as list(). */
  count(filter?: JobFilter): Promise<number>;
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

  /**
   * Record an on-glass signature against a job.
   *
   * Separate from replaceLines but always called with it, inside the same transaction: the
   * signature refers to a specific line set, and a signature that outlived a failed line write
   * would point at prices the customer never saw.
   */
  saveOnSiteSignature(
    jobId: JobId,
    signature: JobSignature,
    signedByUserId: string | null,
    now: Date,
  ): Promise<void>;
  addAddon(addon: JobAddon, now: Date): Promise<void>;
  setAddonStatus(jobId: JobId, addonId: string, status: AddonStatus, now: Date): Promise<number>;
  setAddonInvoiceSkip(jobId: JobId, addonId: string, invoiceSkip: boolean, now: Date): Promise<number>;
  upsertVerifyAnswer(answer: JobVerifyAnswer, now: Date): Promise<void>;
  removeVerifyAnswer(jobId: JobId, itemId: string): Promise<number>;
  addPhoto(photo: JobPhoto, now: Date): Promise<void>;
  removePhoto(jobId: JobId, photoId: string, now: Date): Promise<number>;
  listRecentForCallbackScan(since: Date): Promise<CallbackScanRow[]>;
  // Org-scoped. Confirmed callbacks (callbackReason === "callback", callbackOf non-null) whose
  // CALLBACK job was created on/after `since`, each stitched to its ORIGINAL job (loaded by
  // the callbackOf id). Non-deleted only. Drop any pair whose original is missing/deleted.
  // Two queries max (no N+1).
  listConfirmedCallbacksWithOriginals(since: Date): Promise<AutopsyPairRow[]>;
}
