import type {
  OrgId,
  JobId,
  LeadId,
  EstimateId,
  UserId,
  CursorPage,
  Paginated,
} from "@mallet/shared/types";
import type { Job, JobStatus, JobChecklistProps } from "./job";
import type { JobSort } from "../infra/job-sorts";
import type { JobView } from "../infra/job-views";
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
  /**
   * Exclude finished work — the "open jobs" the nav badge counts.
   *
   * Not expressible as `status`, which is a single value: this is "everything except complete and
   * canceled". It mirrors selectJobsCount in the shell, which is what the badge showed before it
   * was capped at the hydrator's page size.
   */
  readonly activeOnly?: boolean;
  /** One of the scoped views (Needs a slot / Today / …). See infra/job-views.ts. */
  readonly view?: JobView;
  /** The client's local date, YYYY-MM-DD. Required alongside a date-relative view. */
  readonly today?: string;
  /**
   * Jobs with a live visit landing between these dates, inclusive — what the dispatch board shows.
   *
   * A named view cannot answer this: the views are relative to today, and the board navigates to
   * an arbitrary day or week. It read the loaded jobs collection instead, which is capped, so any
   * day past that window drew an EMPTY board — indistinguishable from a day with nothing booked.
   */
  readonly visitFrom?: string;
  readonly visitTo?: string;
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
  /**
   * Still open, OR finished inside this window — what a technician's agenda means.
   *
   * My day used to be two hard status equalities (scheduled + in_progress), so the moment a job
   * was completed it left the list. Owen, testing: "jobs are disappearing after I finish them, the
   * jobs for the day should still be showing but with done status". A day's work you can no longer
   * see is a day you cannot check.
   *
   * ABSOLUTE INSTANTS, supplied by the caller — never a `completed_at::date = today` cast. There
   * is no org timezone column, so the database's idea of "today" is UTC: at 5pm Pacific it is
   * already tomorrow in UTC and the whole afternoon's finished work would vanish.
   *
   * Half-open [from, to). Optional and additive: `v1.jobs.list` (the office list) never sets it and
   * is unaffected.
   */
  readonly openOrCompletedBetween?: { readonly from: Date; readonly to: Date };
}

/** The four execution child collections of one job. */
export interface JobExecution {
  lines: JobLine[];
  addons: JobAddon[];
  verifyAnswers: JobVerifyAnswer[];
  photos: JobPhoto[];
}

/** What an accepted estimate stamps onto the scope-visit job it converts. See adoptEstimateOnJob. */
export interface AdoptEstimatePatch {
  readonly sourceEstimateId: string;
  /** Tax-INCLUSIVE, snapshotted from the estimate's own rounding chain (same as the mint path). */
  readonly totalCents: number;
  readonly taxBps: number;
  readonly taxCents: number;
  readonly title: string | null;
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
  /**
   * Convert a scope-visit job into the sold work IN PLACE — the walkthrough, the quote and the
   * work stay ONE job instead of a duplicate appearing at accept.
   *
   * One UPDATE flips kind='estimate' → 'work' and stamps source_estimate_id, totals and title;
   * then the sold lines replace the job's lines and ONE pending visit is appended AFTER the
   * existing ones (max position + 1) — all inside the caller's transaction, so a failure rolls
   * the whole conversion back.
   *
   * Returns false — converting NOTHING — when the job is missing/archived, already kind='work'
   * (someone's existing work order must never be grabbed), or canceled. The caller falls back to
   * the mint path on false; re-accept idempotency is the caller's findBySourceEstimate pre-check.
   */
  adoptEstimateOnJob(
    orgId: OrgId,
    jobId: JobId,
    patch: AdoptEstimatePatch,
    lines: readonly JobLine[],
    now: Date,
  ): Promise<boolean>;
  list(page: CursorPage, filter?: JobFilter, sort?: JobSort, sortDir?: "asc" | "desc"): Promise<Paginated<Job>>;

  /** How many jobs match the filter, ignoring pagination. Same predicates as list(). */
  count(filter?: JobFilter): Promise<number>;

  /** Every scoped view's count in one round trip. `today` is the client's local YYYY-MM-DD. */
  viewCounts(today: string, base?: JobFilter): Promise<{ counts: Record<JobView, number>; todayCents: number }>;
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
  //
  // The job's stored `total_cents` moves WITH the lines — it is Σ round(quantity × rate_cents),
  // the same arithmetic the signed snapshot and the estimate repository use. Before this it never
  // moved at all, so a job priced through the price builder kept a $0 headline while carrying real
  // lines, and Money's ready-to-bill rollup, the `noPrice` view and the Amount sort all reported
  // zero on sold work.
  //
  // `totalCents` overrides that derivation, and exists for exactly one caller shape: the accepted
  // ESTIMATE, whose total is tax-inclusive and may carry a discount. Neither is reconstructible
  // from the job's lines, so the path that holds the agreed figure passes it and it wins. Omit it
  // anywhere the lines ARE the price (the price builder and the field sign-off, where the tech's
  // quoted tax is already inside the rates).
  replaceLines(jobId: JobId, lines: readonly JobLine[], now: Date, totalCents?: number): Promise<void>;

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
  /**
   * Approve a set of found-work add-ons AND stamp the evidence, in ONE statement.
   *
   * One statement rather than a loop over setAddonStatus because the approvals share a single
   * signature: partial success would leave the customer having signed for three items and the
   * shop holding two. The WHERE clause requires `status = 'proposed'`, so a declined or
   * already-approved row is never swept into somebody else's signature.
   *
   * Returns the ids actually moved — the caller compares them against what it asked for and
   * refuses the whole write on a mismatch rather than silently under-billing.
   */
  approveAddons(
    jobId: JobId,
    addonIds: readonly string[],
    approval: { byUserId: string | null; estimateId: string; at: Date },
    now: Date,
  ): Promise<string[]>;
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
