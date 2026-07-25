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

// 'work' (sold/repair work) | 'estimate' (pre-quote scope visit booked as a job so it
// rides the board/My-Day unchanged).
export type JobKind = "work" | "estimate";

export const JOB_KINDS: readonly JobKind[] = ["work", "estimate"];

export const isJobKind = (value: string): value is JobKind =>
  (JOB_KINDS as readonly string[]).includes(value);

// Reason a job was created as a callback of an earlier job.
// 'callback'   — customer called back about the same original issue (redo / warranty).
// 'new_issue'  — tech found and flagged additional work during a prior visit.
// 'found_work' — office booked follow-on work discovered on-site.
export type CallbackReason = "callback" | "new_issue" | "found_work";

export const CALLBACK_REASONS: readonly CallbackReason[] = [
  "callback",
  "new_issue",
  "found_work",
];

export const isCallbackReason = (value: string): value is CallbackReason =>
  (CALLBACK_REASONS as readonly string[]).includes(value);

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
export const SCOPE_MAX_LENGTH = 4000;

// Before-you-leave checklist bounds (shared with the router's zod input).
// Name/text match the checklist TEMPLATE bounds (checklists router: name ≤ 200,
// item text ≤ 500) so any valid template can always be attached to a job; the
// item cap is mirrored on templates in CreateChecklistUseCase (CHECKLIST_MAX_ITEMS).
export const JOB_CHECKLIST_MAX_ITEMS = 50;
export const JOB_CHECKLIST_NAME_MAX = 200;
export const JOB_CHECKLIST_ITEM_TEXT_MAX = 500;

export interface JobChecklistItemProps {
  readonly id: string;
  readonly text: string;
  readonly type: "check" | "photo";
  readonly required: boolean;
}

// Snapshot of the checklist the office attached to this job (denormalized from the
// template on purpose — later template edits must not rewrite job history). Item order
// is the array order. Crew ANSWERS live in job_verify_answers, not here.
export interface JobChecklistProps {
  readonly name: string;
  readonly items: readonly JobChecklistItemProps[];
}

// Validate + normalize one checklist item. Field types are re-checked at runtime
// because jsonb rows are not trustworthy.
function validateChecklistItem(
  it: JobChecklistItemProps,
): Result<JobChecklistItemProps, ValidationError> {
  const id = typeof it?.id === "string" ? it.id.trim() : "";
  if (id.length === 0) {
    return err(validation("every checklist item needs an id", "checklist"));
  }
  const text = typeof it?.text === "string" ? it.text.trim() : "";
  if (text.length === 0 || text.length > JOB_CHECKLIST_ITEM_TEXT_MAX) {
    return err(
      validation(`checklist item text must be 1–${JOB_CHECKLIST_ITEM_TEXT_MAX} characters`, "checklist"),
    );
  }
  if (it.type !== "check" && it.type !== "photo") {
    return err(validation(`unknown checklist item type: ${String(it.type)}`, "checklist"));
  }
  return ok({ id, text, type: it.type, required: it.required === true });
}

// Validate + normalize an attached checklist (null passes through). Runs inside
// Job.create so BOTH boundaries are covered: the API input (via UpdateJobUseCase →
// patchFields) and the infra read boundary (corrupt jsonb fails loud through the
// mapper's Job.create call).
function normalizeChecklist(
  cl: JobChecklistProps | null,
): Result<JobChecklistProps | null, ValidationError> {
  if (cl === null) return ok(null);
  if (typeof cl !== "object" || !Array.isArray(cl.items)) {
    return err(validation("checklist needs a name and an items list", "checklist"));
  }
  const name = typeof cl.name === "string" ? cl.name.trim() : "";
  if (name.length === 0 || name.length > JOB_CHECKLIST_NAME_MAX) {
    return err(validation(`checklist name must be 1–${JOB_CHECKLIST_NAME_MAX} characters`, "checklist"));
  }
  if (cl.items.length > JOB_CHECKLIST_MAX_ITEMS) {
    return err(
      validation(`a checklist can hold at most ${JOB_CHECKLIST_MAX_ITEMS} items`, "checklist"),
    );
  }
  const items: JobChecklistItemProps[] = [];
  for (const it of cl.items) {
    const item = validateChecklistItem(it);
    if (!item.ok) return item;
    items.push(item.value);
  }
  return ok({ name, items });
}

const MAX_VISIT_DURATION_MINUTES = 24 * 60;

// Default length (2h) seeded onto the single unplaced visit of a quote-created job, so the
// job modal always has an editable Length row and the schedule tray shows real data.
export const DEFAULT_VISIT_DURATION_MINUTES = 120;

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
  /**
   * Geocoded location of the visit's service address (WGS84). Both are null when
   * the location is unknown (office-created or legacy visits). Always set together:
   * JobVisit.create rejects a row where exactly one of the pair is non-null.
   * Optional: callers that omit lat/lng get null/null (no point).
   */
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly status: VisitStatus;
  /**
   * When the tech tapped "On my way". A STAMP, not a fifth status value: a visit being
   * travelled to is still `pending`, and adding a status for it would touch the check
   * constraint, the transition matrix, the job-status derivation and the DTO enum for a fact
   * that is purely informational. Cleared when the visit is reopened, exactly like completedAt —
   * the stamp describes the CURRENT trip, and a reopened visit has no trip yet.
   */
  readonly enrouteAt: Date | null;
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
    // Normalize undefined → null so props always exposes number | null.
    const lat = props.lat ?? null;
    const lng = props.lng ?? null;
    // Both-or-neither: a geocoded point requires both coordinates.
    if ((lat === null) !== (lng === null)) {
      return err(validation("visit lat and lng must be set together", "lat"));
    }
    if (lat !== null && (lat < -90 || lat > 90)) {
      return err(validation("visit lat must be between -90 and 90", "lat"));
    }
    if (lng !== null && (lng < -180 || lng > 180)) {
      return err(validation("visit lng must be between -180 and 180", "lng"));
    }
    return ok(new JobVisit({ ...props, lat, lng }));
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
  readonly kind: JobKind; // 'work' | 'estimate'; defaults to 'work' at create
  readonly status: JobStatus;
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly canceledAt: Date | null;
  readonly cancelReason: string | null;
  readonly total: Money; // integer cents, snapshot from the source estimate at creation
  readonly notes: string | null;
  readonly scope: string | null; // free-text "anything else noticed?" note from the booking flow
  readonly callbackOf: JobId | null; // this job is a callback/redo of an earlier job (nullable)
  readonly callbackReason: CallbackReason | null; // 'callback' | 'new_issue' | 'found_work' (nullable)
  readonly checklist: JobChecklistProps | null; // optional before-you-leave checklist
  readonly requiredCerts: readonly string[] | null; // cert requirement from the booking playbook; null = no requirement
  readonly visits: readonly JobVisit[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Input to Job.create: kind, scope, callbackOf, callbackReason, and requiredCerts may be omitted
// so pre-existing callers keep compiling. kind defaults to "work"; the rest default to null.
export type JobCreateProps = Omit<JobProps, "kind" | "scope" | "callbackOf" | "callbackReason" | "requiredCerts"> & {
  readonly kind?: JobKind;
  readonly scope?: string | null;
  readonly callbackOf?: JobId | null;
  readonly callbackReason?: CallbackReason | null;
  readonly requiredCerts?: readonly string[] | null;
};

// Scheduled field work. Aggregate root with a status state machine
// (scheduled → in_progress → complete; scheduled|in_progress → canceled). complete/canceled are
// terminal. All mutations return new instances (immutability); illegal transitions return errors.
export class Job {
  private constructor(private readonly p: JobProps) {}

  static create(props: JobCreateProps): Result<Job, ValidationError> {
    const num = props.num.trim();
    if (num.length === 0) return err(validation("job number is required", "num"));
    if (!isJobStatus(props.status)) {
      return err(validation(`unknown job status: ${props.status}`, "status"));
    }
    // Runtime re-check (mirrors status): the mapper feeds rows whose kind is plain text.
    const kind = props.kind ?? "work";
    if (!isJobKind(kind)) {
      return err(validation(`unknown job kind: ${String(kind)}`, "kind"));
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
    const rawScope = props.scope ?? null;
    const scope = rawScope === null ? null : rawScope.trim() || null;
    if (scope !== null && scope.length > SCOPE_MAX_LENGTH) {
      return err(validation(`scope note must be at most ${SCOPE_MAX_LENGTH} characters`, "scope"));
    }
    const callbackOf = props.callbackOf ?? null;
    const callbackReason = props.callbackReason ?? null;
    if (callbackReason !== null && !isCallbackReason(callbackReason)) {
      return err(validation(`unknown callback reason: ${String(callbackReason)}`, "callbackReason"));
    }
    let checklist: JobChecklistProps | null = null;
    if (props.checklist !== null) {
      const validated = normalizeChecklist(props.checklist);
      if (!validated.ok) return validated;
      checklist = validated.value;
    }
    const rawRequired = props.requiredCerts ?? null;
    const requiredCerts = rawRequired === null || rawRequired.length === 0 ? null : rawRequired;
    return ok(new Job({ ...props, num, svc, scope, callbackOf, callbackReason, checklist, kind, requiredCerts }));
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
  /** True once the job is closed (complete/canceled) — no further field writes. */
  isTerminal(): boolean {
    return isTerminal(this.p.status);
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
    // Finishing the job finishes its outstanding visits. A pending visit on a completed job is not
    // work anyone is going to do — it is the same job — and leaving them open made the two views
    // of the same fact disagree: the schedule board kept showing an open block for a job My day
    // had already dropped, because the board reads visits and My day reads the job.
    //
    // Only OPEN visits move. A canceled one stays canceled, and one already complete keeps its own
    // completion stamp rather than being restamped with this moment.
    const closed: JobVisit[] = [];
    for (const visit of this.p.visits) {
      if (visit.props.status !== "pending" && visit.props.status !== "in_progress") {
        closed.push(visit);
        continue;
      }
      const done = JobVisit.create({ ...visit.props, status: "complete", completedAt: now });
      // Only the status changed on props the aggregate already accepted, so this cannot fail —
      // but a silent `as` here would hide it if it ever did.
      if (!done.ok) return err(done.error);
      closed.push(done.value);
    }
    return ok(new Job({ ...this.p, visits: closed, status: "complete", completedAt: now, updatedAt: now }));
  }

  // complete → in_progress. "Complete" is terminal for office edits, but field work
  // can resume: reopening a visit on a completed job pulls the job back into progress
  // (SetVisitStatusUseCase). The completion stamp is cleared; the office complete
  // endpoint (CompleteJobUseCase → complete()) works again on the reopened job.
  // canceled stays fully terminal — no reopen.
  reopen(now: Date): Result<Job, ValidationError> {
    if (this.p.status !== "complete") {
      return err(validation("only a completed job can be reopened", "status"));
    }
    return ok(new Job({ ...this.p, status: "in_progress", completedAt: null, updatedAt: now }));
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

  // Field-surface authorization predicate: is this user ON the job — the job-level
  // assignee, or the assignee of any active (non-canceled) visit? Visit-level
  // assignment counts because the schedule board dispatches crew per visit; a
  // canceled visit is no longer a claim to the job. Used by the tech-facing
  // field-router to scope writes (e.g. checklist verify answers) to a tech's own jobs.
  isAssignedTo(userId: UserId): boolean {
    if (this.p.assigneeUserId === userId) return true;
    return this.p.visits.some(
      (v) => v.props.status !== "canceled" && v.props.assigneeUserId === userId,
    );
  }

  /**
   * Is this user the person assigned to THIS specific visit?
   *
   * Distinct from `isAssignedTo`, which is job-level and true for the job's assignee OR the assignee
   * of any of its visits. That is the right question for "may this tech open this job", and the
   * WRONG question for "may this tech complete this visit": on a two-visit job the job-level
   * assignee would pass the check for a colleague's visit and could mark it done — moving someone
   * else's work and writing time against it. Visit-scoped actions must ask this instead.
   *
   * The job-level assignee is deliberately NOT granted access here. A lead tech who needs to close
   * out a colleague's visit is doing an office action, and the office endpoint exists for it.
   */
  isAssignedToVisit(userId: UserId, visitId: VisitId): boolean {
    const visit = this.p.visits.find((v) => v.props.id === visitId);
    if (!visit) return false;
    if (visit.props.status === "canceled") return false;
    return visit.props.assigneeUserId === userId;
  }

  // Set (or clear, with null) the single assignee. Not allowed once terminal.
  assignTo(userId: UserId | null, now: Date): Result<Job, ValidationError> {
    if (isTerminal(this.p.status)) {
      return err(validation("cannot change the assignee of a finished job", "status"));
    }
    return ok(new Job({ ...this.p, assigneeUserId: userId, updatedAt: now }));
  }

  // Patch DB-backed fields (title/svc/notes/checklist) while the job is not terminal.
  // Undefined = keep current; explicit null clears an optional field. Re-validates
  // through Job.create (mirrors Company.patch).
  patchFields(
    fields: {
      title?: string | null;
      svc?: string | null;
      notes?: string | null;
      checklist?: JobChecklistProps | null;
    },
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
      checklist: fields.checklist !== undefined ? fields.checklist : this.p.checklist,
      updatedAt: now,
    });
  }

  markCallback(originalId: JobId, reason: CallbackReason, now: Date): Result<Job, ValidationError> {
    if (originalId === this.p.id) return err(validation("a job cannot be a callback of itself", "callbackOf"));
    return ok(new Job({ ...this.p, callbackOf: originalId, callbackReason: reason, updatedAt: now }));
  }

  dismissCallback(now: Date): Result<Job, ValidationError> {
    return ok(new Job({ ...this.p, callbackOf: null, callbackReason: "new_issue", updatedAt: now }));
  }

  get props(): JobProps {
    return this.p;
  }
}
