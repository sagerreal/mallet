import type {
  JobId,
  OrgId,
  LeadId,
  EstimateId,
  UserId,
  VisitId,
  Money,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type JobStatus = "scheduled" | "in_progress" | "complete" | "canceled";

export const JOB_STATUSES: readonly JobStatus[] = [
  "scheduled",
  "in_progress",
  "complete",
  "canceled",
];

export const isJobStatus = (value: string): value is JobStatus =>
  (JOB_STATUSES as readonly string[]).includes(value);

export type VisitStatus = "pending" | "in_progress" | "complete" | "canceled";

export const JOB_VISIT_STATUSES: readonly VisitStatus[] = [
  "pending",
  "in_progress",
  "complete",
  "canceled",
];

export const isVisitStatus = (value: string): value is VisitStatus =>
  (JOB_VISIT_STATUSES as readonly string[]).includes(value);

const isTerminal = (status: JobStatus): boolean => status === "complete" || status === "canceled";

const SVC_MAX_LENGTH = 60;

const MAX_VISIT_DURATION_MINUTES = 24 * 60;

export interface JobVisitProps {
  readonly id: VisitId;
  readonly assigneeUserId: UserId | null;
  readonly scheduledDate: string | null; // ISO "YYYY-MM-DD", nullable when unplaced
  readonly scheduledStart: string | null; // "HH:MM", nullable when unplaced
  readonly scheduledEnd: string | null; // "HH:MM", nullable when unplaced
  /**
   * Authoritative visit length in whole minutes. Persists for BOTH placed and
   * unplaced visits (an unplaced visit has no start/end window to derive from).
   * Null only for legacy rows created before the duration_minutes column.
   */
  readonly durationMinutes: number | null;
  readonly status: VisitStatus;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly notes: string | null;
  readonly position: number;
}

// A single scheduled visit on a job. Immutable value object (mirrors EstimateLine).
export class JobVisit {
  private constructor(private readonly p: JobVisitProps) {}

  static create(props: JobVisitProps): Result<JobVisit, ValidationError> {
    if (!isVisitStatus(props.status)) {
      return err(validation(`unknown visit status: ${props.status}`, "status"));
    }
    if (
      props.scheduledStart !== null &&
      props.scheduledEnd !== null &&
      props.scheduledEnd <= props.scheduledStart
    ) {
      return err(validation("visit scheduled end must be after start", "scheduledEnd"));
    }
    if (
      props.durationMinutes !== null &&
      (!Number.isInteger(props.durationMinutes) ||
        props.durationMinutes <= 0 ||
        props.durationMinutes > MAX_VISIT_DURATION_MINUTES)
    ) {
      return err(validation("visit duration must be 1–1440 whole minutes", "durationMinutes"));
    }
    return ok(new JobVisit({ ...props }));
  }

  // A visit is placed when it has a date, an assignee, and a start time.
  isPlaced(): boolean {
    return (
      this.p.scheduledDate !== null &&
      this.p.assigneeUserId !== null &&
      this.p.scheduledStart !== null
    );
  }

  get props(): JobVisitProps {
    return this.p;
  }
}

export interface JobProps {
  readonly id: JobId;
  readonly orgId: OrgId;
  readonly num: string; // per-org "JOB-<n>"
  readonly leadId: LeadId;
  readonly sourceEstimateId: EstimateId | null;
  readonly assigneeUserId: UserId | null;
  readonly title: string | null;
  readonly svc: string | null; // service type; nullable
  readonly status: JobStatus;
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly cancelReason: string | null;
  readonly total: Money; // integer cents, snapshot from the source estimate at creation
  readonly notes: string | null;
  readonly visits: readonly JobVisit[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Scheduled field work. Aggregate root with a status state machine
// (scheduled → in_progress → complete; scheduled|in_progress → canceled). complete/canceled are
// terminal. All mutations return new instances (immutability); illegal transitions return errors.
export class Job {
  private constructor(private readonly p: JobProps) {}

  static create(props: JobProps): Result<Job, ValidationError> {
    const num = props.num.trim();
    if (num.length === 0) return err(validation("job number is required", "num"));
    if (!isJobStatus(props.status)) {
      return err(validation(`unknown job status: ${props.status}`, "status"));
    }
    if (props.total < 0) return err(validation("job total cannot be negative", "total"));
    if (
      props.scheduledStart !== null &&
      props.scheduledEnd !== null &&
      props.scheduledEnd < props.scheduledStart
    ) {
      return err(validation("scheduled end cannot be before start", "scheduledEnd"));
    }
    if (props.status === "canceled" && (props.cancelReason ?? "").trim().length === 0) {
      return err(validation("a canceled job requires a reason", "cancelReason"));
    }
    const svc = props.svc === null ? null : props.svc.trim();
    if (svc !== null && (svc.length === 0 || svc.length > SVC_MAX_LENGTH)) {
      return err(validation("service type must be 1–60 characters", "svc"));
    }
    return ok(new Job({ ...props, num, svc }));
  }

  // Replace the visit set — only allowed while the job is not yet terminal.
  withVisits(visits: readonly JobVisit[], now: Date): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot modify visits on a completed or canceled job", "status"));
    }
    return ok(new Job({ ...this.p, visits, updatedAt: now }));
  }

  canStart(): boolean {
    return this.p.status === "scheduled";
  }
  canComplete(): boolean {
    return this.p.status === "in_progress";
  }
  canCancel(): boolean {
    return this.p.status === "scheduled" || this.p.status === "in_progress";
  }

  // Set/adjust the scheduled window while the job is still open.
  schedule(start: Date, end: Date, now: Date): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot reschedule a completed or canceled job", "status"));
    }
    if (end < start) return err(validation("scheduled end cannot be before start", "scheduledEnd"));
    return ok(new Job({ ...this.p, scheduledStart: start, scheduledEnd: end, updatedAt: now }));
  }

  // scheduled → in_progress. Idempotent: re-starting an in_progress job is a no-op (same instance).
  start(now: Date): Result<Job, ValidationError> {
    if (this.p.status === "in_progress") return ok(this);
    if (!this.canStart()) return err(validation("only a scheduled job can be started", "status"));
    return ok(new Job({ ...this.p, status: "in_progress", startedAt: now, updatedAt: now }));
  }

  // in_progress → complete.
  complete(now: Date): Result<Job, ValidationError> {
    if (!this.canComplete()) {
      return err(validation("only an in-progress job can be completed", "status"));
    }
    return ok(new Job({ ...this.p, status: "complete", completedAt: now, updatedAt: now }));
  }

  // scheduled|in_progress → canceled, capturing the reason.
  cancel(reason: string, now: Date): Result<Job, ValidationError> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) return err(validation("a cancel reason is required", "cancelReason"));
    if (!this.canCancel()) return err(validation("this job can no longer be canceled", "status"));
    return ok(
      new Job({ ...this.p, status: "canceled", canceledAt: now, cancelReason: trimmed, updatedAt: now }),
    );
  }

  // Set (or clear, with null) the single assignee. Not allowed once terminal.
  assignTo(userId: UserId | null, now: Date): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot change the assignee of a finished job", "status"));
    }
    return ok(new Job({ ...this.p, assigneeUserId: userId, updatedAt: now }));
  }

  // Patch DB-backed scalar fields (title/svc/notes) while the job is not terminal.
  // Undefined = keep current; explicit null clears an optional field. Re-validates
  // through Job.create (mirrors Company.patch).
  patchFields(
    fields: { title?: string | null; svc?: string | null; notes?: string | null },
    now: Date,
  ): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot edit a completed or canceled job", "status"));
    }
    return Job.create({
      ...this.p,
      title: fields.title !== undefined ? fields.title : this.p.title,
      svc: fields.svc !== undefined ? fields.svc : this.p.svc,
      notes: fields.notes !== undefined ? fields.notes : this.p.notes,
      updatedAt: now,
    });
  }

  get props(): JobProps {
    return this.p;
  }
}
