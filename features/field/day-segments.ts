/**
 * features/field/day-segments.ts
 * Today's clock, as segments — pure. No React, no network, no `new Date()` read from inside.
 *
 * Built on the tested read-only helpers in my-hours-derive.ts (KIND_LABELS, clockLabel,
 * entryHours, isPaidKind, sortByStart) rather than a second set: My hours and this panel are two
 * views of the same rows and must not be able to disagree about what an hour is.
 *
 * `isPaidKind` and NOT `paidHours`, deliberately and for one reason only: paidHours measures a row
 * with `entryHours`, which returns 0 while the row is still running, and this panel exists to
 * count the stretch the technician is standing in (see 1 below). So the LENGTH is measured here
 * and the POLICY — which kinds are unpaid — is imported. Hand-rolling the `kind === "break"` test
 * instead would state the policy twice, and the day the shop gains a second unpaid kind the two
 * surfaces would quietly disagree about what the man is owed.
 *
 * THREE THINGS THE ROWS DO NOT GIVE YOU FOR FREE:
 *
 *  1. THE RUNNING SEGMENT COUNTS FOR NOTHING. `entryHours` returns 0 for a row with no `endTime`,
 *     which is right for a timesheet — an unfinished stretch is not yet hours — and wrong for a
 *     man looking at his own day at 3pm. A naive sum silently omits the minutes he is standing
 *     in. The open row's length is measured against `now` here, by hand.
 *  2. THE SERVER'S INTRA-DAY ORDER IS `(work_date, id)` — i.e. UUID order within a day
 *     (modules/timesheets/infra/timesheet-sorts.ts). Unsorted, the day renders in an order that
 *     has nothing to do with when anything happened. `sortByStart` fixes it client-side.
 *  3. A DAY IS A CHAIN OF ADJACENT ROWS, not a shift with a wrapper. Its start is the earliest
 *     `start_time` of today's rows; there is no shift record to read one off.
 */

import {
  KIND_LABELS,
  clockLabel,
  entryHours,
  isPaidKind,
  sortByStart,
  type MyHoursEntry,
} from "./my-hours-derive";
import { MINUTES_PER_HOUR, MS_PER_MINUTE } from "@/lib/time";

export interface DaySegment {
  readonly id: string;
  /** "Shop" / "Break" / "Travel", or the job this stretch was worked on. */
  readonly label: string;
  /** "7:42a – 9:15a", or "2:58p –" while it is still running. */
  readonly span: string;
  /** Length in decimal hours. For the running row, measured against `now`. */
  readonly hours: number;
  readonly kind: MyHoursEntry["kind"];
  readonly running: boolean;
}

export interface DaySummary {
  readonly segments: readonly DaySegment[];
  /** When the day began — the earliest start among today's rows. Null on a day with no rows. */
  readonly dayStart: string | null;
  /** Everything that is not a break. Break is the only unpaid kind, and that is the whole policy. */
  readonly workedHours: number;
  readonly breakHours: number;
}

/** Decimal hours → "6:38". Tabular h:mm, the format a timesheet is read in. */
export function hoursClock(h: number): string {
  const totalMinutes = Math.max(0, Math.round(h * MINUTES_PER_HOUR));
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  return `${hours}:${String(totalMinutes % MINUTES_PER_HOUR).padStart(2, "0")}`;
}

/**
 * How long the open row has been running, in decimal hours.
 *
 * Parsed the same way the day clock's own elapsed is (`${workDate}T${startTime}`), which means it
 * reads the SHOP's wall clock in the DEVICE's zone — a technician working in a different timezone
 * from the shop gets a figure off by the offset. That is a pre-existing property of every elapsed
 * figure in this app, not something introduced here; negatives are clamped to zero rather than
 * shown, because a negative stretch is a clock-skew artefact and not information.
 */
function runningHours(entry: MyHoursEntry, now: Date): number {
  const started = new Date(`${entry.workDate}T${entry.startTime}:00`);
  if (Number.isNaN(started.getTime())) return 0;
  const minutes = Math.floor((now.getTime() - started.getTime()) / MS_PER_MINUTE);
  return minutes <= 0 ? 0 : minutes / MINUTES_PER_HOUR;
}

/** Resolves a job segment's row to something a person recognises. */
export type JobLabeller = (jobId: string) => string | null;

/**
 * Today's day, from the whole 12-week list the field layout already fetches.
 *
 * `todayISO` filters on the row's `work_date` — the SHOP's date, written server-side. That is the
 * right key for a day summary, and it also means a stretch that crossed midnight appears here as
 * only its second half: the server splits such a row in two on two work dates, so the 10:40pm
 * emergency call reads as starting at midnight. Naming it, because a summary that silently
 * truncated it would be worse.
 */
export function daySummary(
  entries: readonly MyHoursEntry[],
  todayISO: string,
  now: Date,
  jobLabel: JobLabeller,
): DaySummary {
  const today = sortByStart(entries.filter((e) => e.workDate === todayISO));

  const segments = today.map((e): DaySegment => {
    const running = !e.endTime;
    const named = e.kind === "job" && e.jobId ? jobLabel(e.jobId) : null;
    return {
      id: e.id,
      label: named ?? KIND_LABELS[e.kind],
      span: running ? `${clockLabel(e.startTime)} –` : `${clockLabel(e.startTime)} – ${clockLabel(e.endTime)}`,
      hours: running ? runningHours(e, now) : entryHours(e),
      kind: e.kind,
      running,
    };
  });

  let workedHours = 0;
  let breakHours = 0;
  for (const s of segments) {
    if (isPaidKind(s.kind)) workedHours += s.hours;
    else breakHours += s.hours;
  }

  return {
    segments,
    dayStart: today[0] ? clockLabel(today[0].startTime) : null,
    workedHours,
    breakHours,
  };
}
