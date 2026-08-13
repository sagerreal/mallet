import type { OrgId, JobId, Result, AppError, Clock, LeadId } from "@mallet/shared/types";
import { isOk } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { JobStatus } from "../domain/job";
import type { CreateManualJobUseCase } from "./create-manual-job";
import type { CreateVisitUseCase } from "./create-visit";

/**
 * Bulk-import jobs from a spreadsheet.
 *
 * The one thing that makes this harder than the customer and service imports: a job row NAMES its
 * customer rather than carrying an id, so every row needs resolving to a real lead first. That
 * resolution is batched by the caller (ResolveCustomerRefsUseCase) and handed in already done —
 * this use-case stays about jobs.
 *
 * Per-row failures never throw. One unreadable row must not roll back a 500-row chunk, so every
 * row is classified and counted, exactly as importCustomers and importServices do.
 */

/** A row after client-side coercion, with its customer already resolved to an id. */
export interface ImportJobRow {
  readonly leadId: LeadId;
  readonly svc: string | null;
  readonly scope: string | null;
  readonly addr: string | null;
  readonly status: JobStatus;
  /** "YYYY-MM-DD", or null when the sheet carried no date. */
  readonly scheduledDate: string | null;
  /** "HH:MM", or null to fall back to the org's opening hour for that weekday. */
  readonly scheduledStart: string | null;
  /** Set when the customer name matched more than one existing record. */
  readonly ambiguousName?: string;
}

export interface ImportJobsCommand {
  readonly orgId: OrgId;
  readonly rows: readonly ImportJobRow[];
  /**
   * Org opening hour per weekday, index 0 = Sunday. A row with a date but no time is scheduled at
   * its weekday's opening hour — a shop migrating a calendar wants the visit ON the board, and the
   * opening hour is the least surprising placement. 0/0 (closed) falls back to DEFAULT_START_HOUR.
   */
  readonly openHourByWeekday: readonly number[];
}

export interface ImportJobsResult {
  readonly created: number;
  /** Rows that could not be turned into a job. Never throws — the batch continues. */
  readonly failed: number;
  readonly errors: readonly { index: number; message: string }[];
  /** Rows whose customer name was ambiguous, so a NEW customer was created for them. */
  readonly ambiguous: readonly { index: number; name: string }[];
}

/** Duration for an imported visit. One hour is a neutral placeholder the shop can drag. */
const IMPORT_VISIT_HOURS = 1;

/** Used when a row has a date but the org is marked closed that weekday. */
const DEFAULT_START_HOUR = 8;

const hhmm = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** Weekday index (0 = Sunday) for a "YYYY-MM-DD" date, without timezone drift. */
const weekdayOf = (date: string): number | null => {
  const parts = date.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export class ImportJobsUseCase {
  constructor(
    private readonly createJob: CreateManualJobUseCase,
    private readonly createVisit: CreateVisitUseCase,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ImportJobsCommand): Promise<Result<ImportJobsResult, AppError>> {
    let created = 0;
    let failed = 0;
    const errors: { index: number; message: string }[] = [];
    const ambiguous: { index: number; name: string }[] = [];

    for (let i = 0; i < cmd.rows.length; i++) {
      const row = cmd.rows[i]!;

      const job = await this.createJob.exec({
        orgId: cmd.orgId,
        leadId: row.leadId,
        // Imported work is real work, never a pre-quote scope visit.
        kind: "work",
        // The Service column IS the job's name. Passing null here left every imported job
        // rendering as "Job" (both mappers do `dto.title ?? "Job"`), so a 200-row import produced
        // 200 identical rows with the service text sitting unread in svc. Derived HERE, before
        // create-manual-job's normalizeSvcKind nulls svc on an "estimate" row.
        title: row.svc?.trim() || row.scope?.trim() || null,
        svc: row.svc,
        addr: row.addr,
        phone: null,
        notes: null,
        scope: row.scope,
      });

      if (!isOk(job)) {
        failed += 1;
        errors.push({ index: i, message: job.error.message });
        continue;
      }

      if (row.ambiguousName) ambiguous.push({ index: i, name: row.ambiguousName });

      // A dated row lands on the board; an undated one is a real job that simply is not scheduled
      // yet, so it imports without a visit rather than being dropped.
      if (row.scheduledDate) {
        const placed = await this.placeVisit(job.value.props.id, row, cmd.openHourByWeekday);
        if (!placed) {
          // The job exists and is usable; only its placement failed. Reported, not fatal.
          errors.push({ index: i, message: "Job imported, but its visit could not be scheduled." });
        }
      }

      created += 1;
    }

    logger.info(
      { orgId: cmd.orgId, created, failed, ambiguous: ambiguous.length },
      "jobs.imported",
    );
    return { ok: true, value: { created, failed, errors, ambiguous } };
  }

  private async placeVisit(
    jobId: JobId,
    row: ImportJobRow,
    openHourByWeekday: readonly number[],
  ): Promise<boolean> {
    const start = row.scheduledStart ?? this.openingTimeFor(row.scheduledDate!, openHourByWeekday);
    const visit = await this.createVisit.exec({
      jobId,
      assigneeUserId: null,
      scheduledDate: row.scheduledDate,
      scheduledStart: start,
      durationHours: IMPORT_VISIT_HOURS,
      notes: null,
    });
    return isOk(visit);
  }

  private openingTimeFor(date: string, openHourByWeekday: readonly number[]): string {
    const weekday = weekdayOf(date);
    if (weekday === null) return hhmm(DEFAULT_START_HOUR);
    const open = openHourByWeekday[weekday];
    // 0 is the "closed" sentinel, not midnight — a shop importing a Sunday job still wants it
    // placed somewhere sane rather than at 00:00.
    return hhmm(open && open > 0 ? open : DEFAULT_START_HOUR);
  }
}
