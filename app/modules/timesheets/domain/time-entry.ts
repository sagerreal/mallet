import type { TimeEntryId, OrgId, UserId, JobId, Result, ValidationError, AppError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// Allowed enum values — narrowed from text columns in the DB.
//
// Two FAMILIES of kind, two shapes of entry. Clock kinds are stretches of a working day and
// carry punch times; time-off kinds are paid absence and carry only a length in minutes — a
// PTO day has no clock. The factory below makes a mixed shape unconstructible, mirroring the
// time_entries_kind_shape_check constraint.
export type ClockEntryKind = "job" | "travel" | "break" | "shop";
export type TimeOffKind = "pto" | "vacation" | "sick" | "holiday";
export type TimeEntryKind = ClockEntryKind | TimeOffKind;
export type TimeEntrySrc = "manual" | "clock" | "timer";
export type TimeEntryStatus = "draft" | "approved";

const CLOCK_KINDS: readonly ClockEntryKind[] = ["job", "travel", "break", "shop"];
export const TIME_OFF_KINDS: readonly TimeOffKind[] = ["pto", "vacation", "sick", "holiday"];
const KINDS: readonly TimeEntryKind[] = [...CLOCK_KINDS, ...TIME_OFF_KINDS];
const SRCS: readonly TimeEntrySrc[] = ["manual", "clock", "timer"];
const STATUSES: readonly TimeEntryStatus[] = ["draft", "approved"];

/** A whole day — the ceiling on a single time-off entry (multi-day PTO is one entry per day). */
const MAX_TIME_OFF_MINUTES = 1440;

const isKind = (v: string): v is TimeEntryKind => KINDS.includes(v as TimeEntryKind);
export const isTimeOffKind = (v: string): v is TimeOffKind =>
  TIME_OFF_KINDS.includes(v as TimeOffKind);
const isSrc = (v: string): v is TimeEntrySrc => SRCS.includes(v as TimeEntrySrc);
const isStatus = (v: string): v is TimeEntryStatus => STATUSES.includes(v as TimeEntryStatus);

// Parse "HH:MM" → total minutes since midnight. Returns null if unparseable.
// Exported for overlap.ts — one parser, so the overlap rule and the entry invariants can never
// disagree about what a time string means.
export const toMinutes = (t: string): number | null => {
  const parts = t.split(":");
  const h = parts[0] !== undefined ? parseInt(parts[0], 10) : NaN;
  const m = parts[1] !== undefined ? parseInt(parts[1], 10) : NaN;
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

export interface TimeEntryProps {
  readonly id: TimeEntryId;
  readonly orgId: OrgId;
  readonly techUserId: UserId;
  readonly jobId: JobId | null;
  readonly workDate: string; // YYYY-MM-DD
  readonly kind: TimeEntryKind;
  readonly startTime: string | null; // HH:MM; null only on time-off kinds
  readonly endTime: string | null; // HH:MM or null (running timer / time-off)
  readonly minutes: number | null; // time-off length; null on clock kinds
  readonly note: string;
  readonly src: TimeEntrySrc;
  readonly status: TimeEntryStatus;
  readonly running: boolean;
  readonly approvedAt: Date | null;
  /** Who last HAND-edited this row (null = untouched tap-truth). Payroll review needs to tell
   *  tap-truth from thumb-truth, and whose thumb. */
  readonly editedByUserId: UserId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// TimeEntry value object. All mutations return new instances (immutability). The factory
// enforces invariants so an invalid TimeEntry cannot exist.
export class TimeEntry {
  private constructor(private readonly p: TimeEntryProps) {}

  static create(props: TimeEntryProps): Result<TimeEntry, ValidationError> {
    if (!isKind(props.kind)) {
      return err(validation(`invalid kind: "${props.kind}"`, "kind"));
    }
    if (!isSrc(props.src)) {
      return err(validation(`invalid src: "${props.src}"`, "src"));
    }
    if (!isStatus(props.status)) {
      return err(validation(`invalid status: "${props.status}"`, "status"));
    }
    if (isTimeOffKind(props.kind)) {
      // Time-off shape: a length, never punch times, never running — there is no clock to a
      // day off.
      if (props.startTime !== null || props.endTime !== null) {
        return err(validation("a time-off entry carries no punch times", "startTime"));
      }
      if (
        props.minutes === null ||
        !Number.isInteger(props.minutes) ||
        props.minutes < 1 ||
        props.minutes > MAX_TIME_OFF_MINUTES
      ) {
        return err(validation("time-off minutes must be a whole number within one day", "minutes"));
      }
      if (props.running) {
        return err(validation("a time-off entry cannot be running", "running"));
      }
      return ok(new TimeEntry(props));
    }
    // Clock shape: punch times, never a time-off length.
    if (props.minutes !== null) {
      return err(validation("a clocked entry derives its length from its times", "minutes"));
    }
    if (props.startTime === null) {
      return err(validation("a clocked entry needs a start time", "startTime"));
    }
    const start = toMinutes(props.startTime);
    if (start === null) {
      return err(validation(`invalid startTime: "${props.startTime}"`, "startTime"));
    }
    if (props.endTime !== null) {
      const end = toMinutes(props.endTime);
      if (end === null) {
        return err(validation(`invalid endTime: "${props.endTime}"`, "endTime"));
      }
      if (end <= start) {
        return err(validation("endTime must be after startTime", "endTime"));
      }
    }
    return ok(new TimeEntry(props));
  }

  // Derive duration in decimal hours. Time-off entries carry it as minutes; clocked entries
  // derive it from their punch times when both are present. Returns null for a running clock.
  hours(): number | null {
    if (this.p.minutes !== null) return this.p.minutes / 60;
    if (!this.p.startTime || !this.p.endTime) return null;
    const start = toMinutes(this.p.startTime);
    const end = toMinutes(this.p.endTime);
    if (start === null || end === null) return null;
    return (end - start) / 60;
  }

  // Return a new entry with the given fields patched. Runs all invariants.
  patch(
    fields: Partial<
      Pick<
        TimeEntryProps,
        "jobId" | "workDate" | "kind" | "startTime" | "endTime" | "minutes" | "note" | "src" | "running"
      >
    >,
    now: Date,
    editedBy?: UserId,
  ): Result<TimeEntry, AppError> {
    return TimeEntry.create({
      ...this.p,
      ...fields,
      // A hand edit signs the row; a system write (the clock closing a segment) leaves the
      // existing trail untouched rather than erasing who last corrected it.
      editedByUserId: editedBy ?? this.p.editedByUserId,
      updatedAt: now,
    });
  }

  // Approve the entry. Returns a new immutable instance with status='approved' and approvedAt set.
  approve(now: Date): TimeEntry {
    return new TimeEntry({ ...this.p, status: "approved", approvedAt: now, updatedAt: now });
  }

  // Reopen the entry (management action). Returns a new immutable instance with
  // status='draft' and approvedAt=null. Symmetric with approve().
  reopen(now: Date): TimeEntry {
    return new TimeEntry({ ...this.p, status: "draft", approvedAt: null, updatedAt: now });
  }

  get props(): TimeEntryProps {
    return this.p;
  }
}
