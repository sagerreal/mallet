import type { OrgId, UserId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * A technician's attestation that a week of hours is complete and correct — the state between
 * draft entries and the office's approval.
 *
 * Precedence is Approved > Submitted > Draft, and approval lives on the ENTRIES
 * (time_entries.status), deliberately not duplicated here: this record answers "has the tech
 * signed off", never "has the office".
 *
 * `reopenedAt` is the clock-outranks-submission rule: the punch clock never refuses, so hours
 * landing AFTER a submit reopen the attestation (with the reason) rather than being locked
 * out. A reopened submission is not an attestation — `isActive()` is the one question the
 * edit-lock asks.
 */

const WEEK_START_RE = /^\d{4}-\d{2}-\d{2}$/;

/** JS getDay() for a YYYY-MM-DD date, derived in UTC so the server's zone never shifts it. */
const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

const MONDAY = 1;

export interface WeekSubmissionProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly techUserId: UserId;
  readonly weekStart: string; // Monday, YYYY-MM-DD
  readonly submittedAt: Date;
  readonly reopenedAt: Date | null;
  readonly reopenReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WeekSubmission {
  private constructor(private readonly p: WeekSubmissionProps) {}

  static create(props: WeekSubmissionProps): Result<WeekSubmission, ValidationError> {
    if (!WEEK_START_RE.test(props.weekStart)) {
      return err(validation(`invalid weekStart: "${props.weekStart}"`, "weekStart"));
    }
    // The submission grain is THE WEEK, and weeks start Monday (the same grain approveWeek
    // uses). A mid-week date here would silently create a second, overlapping attestation
    // stream for the same hours.
    if (weekdayOf(props.weekStart) !== MONDAY) {
      return err(validation("weekStart must be a Monday", "weekStart"));
    }
    return ok(new WeekSubmission(props));
  }

  /** An attestation that still stands — submitted and not since reopened. */
  isActive(): boolean {
    return this.p.reopenedAt === null;
  }

  /** New hours landed after the tech signed off — the attestation no longer covers the week. */
  reopen(reason: string, now: Date): WeekSubmission {
    return new WeekSubmission({
      ...this.p,
      reopenedAt: now,
      reopenReason: reason,
      updatedAt: now,
    });
  }

  /** The tech signs off again after a reopen — the same row becomes the standing attestation. */
  resubmit(now: Date): WeekSubmission {
    return new WeekSubmission({
      ...this.p,
      submittedAt: now,
      reopenedAt: null,
      reopenReason: null,
      updatedAt: now,
    });
  }

  get props(): WeekSubmissionProps {
    return this.p;
  }
}

/** The Monday of the week containing `date` — the submission key for any work date. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  const back = (day - MONDAY + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
