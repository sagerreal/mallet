import type { TimeEntryId, OrgId, UserId, JobId, Result, ValidationError, AppError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// Allowed enum values — narrowed from text columns in the DB.
export type TimeEntryKind = "job" | "travel" | "break" | "shop";
export type TimeEntrySrc = "manual" | "clock" | "timer";
export type TimeEntryStatus = "draft" | "approved";

const KINDS: readonly TimeEntryKind[] = ["job", "travel", "break", "shop"];
const SRCS: readonly TimeEntrySrc[] = ["manual", "clock", "timer"];
const STATUSES: readonly TimeEntryStatus[] = ["draft", "approved"];

const isKind = (v: string): v is TimeEntryKind => KINDS.includes(v as TimeEntryKind);
const isSrc = (v: string): v is TimeEntrySrc => SRCS.includes(v as TimeEntrySrc);
const isStatus = (v: string): v is TimeEntryStatus => STATUSES.includes(v as TimeEntryStatus);

// Parse "HH:MM" → total minutes since midnight. Returns null if unparseable.
const toMinutes = (t: string): number | null => {
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
  readonly startTime: string; // HH:MM
  readonly endTime: string | null; // HH:MM or null (running timer)
  readonly note: string;
  readonly src: TimeEntrySrc;
  readonly status: TimeEntryStatus;
  readonly running: boolean;
  readonly approvedAt: Date | null;
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
    if (props.endTime !== null) {
      const start = toMinutes(props.startTime);
      const end = toMinutes(props.endTime);
      if (start === null) {
        return err(validation(`invalid startTime: "${props.startTime}"`, "startTime"));
      }
      if (end === null) {
        return err(validation(`invalid endTime: "${props.endTime}"`, "endTime"));
      }
      if (end <= start) {
        return err(validation("endTime must be after startTime", "endTime"));
      }
    }
    return ok(new TimeEntry(props));
  }

  // Derive duration in decimal hours when both times are present. Returns null otherwise.
  hours(): number | null {
    if (!this.p.endTime) return null;
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
        "jobId" | "workDate" | "kind" | "startTime" | "endTime" | "note" | "src" | "running"
      >
    >,
    now: Date,
  ): Result<TimeEntry, AppError> {
    return TimeEntry.create({
      ...this.p,
      ...fields,
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
