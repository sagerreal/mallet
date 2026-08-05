/**
 * features/field/day-clock-view.ts
 * The day clock's view model — pure. No React, no network, no `new Date()` read from inside.
 *
 * Everything the day row shows is derived here so the three states and the copy on them can be
 * tested directly, and so the component is left with nothing but wiring.
 */

import { timeLabelShort, MINUTES_PER_HOUR } from "@/lib/time";

/**
 * What the day row is showing.
 *
 * Deliberately coarser than the entry's `kind`: travel, on-site and shop time are all simply "on
 * the clock" to the man reading the row at 7am. He is being told whether he is being paid, not
 * which bucket the office will cost it to.
 */
export type DayClockState = "off" | "on" | "break";

/** The day-level taps this row can make. Mirrors the router's DAY_CLOCK_TAPS enum. */
export type DayClockTap = "start_day" | "break" | "end_break" | "end_day";

/**
 * The part of the timesheet DTO the row reads. Structural rather than the DTO type itself, so the
 * wire shape can grow without dragging this file into it.
 */
export interface OpenEntryView {
  readonly kind: "job" | "travel" | "break" | "shop";
  /** YYYY-MM-DD, in the SHOP's timezone — the server wrote it, the device did not. */
  readonly workDate: string;
  /** HH:MM, the shop's wall clock. */
  readonly startTime: string;
}

export interface DayClockView {
  readonly state: DayClockState;
  /** "On the clock" / "On break" / "Off the clock". */
  readonly title: string;
  /** "since 7:42a", or "" when nothing is running. */
  readonly since: string;
}

/** One button on the row. */
export interface DayClockAction {
  readonly tap: DayClockTap;
  readonly label: string;
  /** The action the row is FOR. The other one is the qualifier beside it. */
  readonly primary: boolean;
}

const TITLE: Record<DayClockState, string> = {
  off: "Off the clock",
  on: "On the clock",
  break: "On break",
};

/**
 * What each state offers. Exhaustive by construction — a state with no actions would be a row the
 * technician cannot get out of, which on a payroll clock means unbounded paid hours.
 */
export const DAY_CLOCK_ACTIONS: Record<DayClockState, readonly DayClockAction[]> = {
  off: [{ tap: "start_day", label: "Start day", primary: true }],
  on: [
    { tap: "break", label: "Break", primary: false },
    { tap: "end_day", label: "End day", primary: true },
  ],
  break: [{ tap: "end_break", label: "End break", primary: true }],
};

/**
 * The name a failed tap is reported under. It becomes a sentence the technician reads
 * ("Couldn't start day — your change was undone"), so it names the button he pressed rather than
 * the endpoint it called.
 */
export const WRITE_ACTION_FOR_TAP: Record<DayClockTap, string> = {
  start_day: "startDay",
  break: "startBreak",
  end_break: "endBreak",
  end_day: "endDay",
};

/** What each tap leaves the clock in, if the server accepts it. */
const STATE_AFTER_TAP: Record<DayClockTap, DayClockState> = {
  start_day: "on",
  break: "break",
  end_break: "on",
  end_day: "off",
};

/**
 * "07:42" → "7:42a", through the app's one compact clock formatter.
 *
 * The guard is not paperwork: `TimeEntry.create` only parses the times of a FINISHED row, so a
 * running row's `startTime` reaches this screen unvalidated. Passing junk to the formatter would
 * render a confident "12a" — a wrong hour on a payroll row is worse than an ugly one — so an
 * unparseable time is shown exactly as it came, where the man reading it can report it.
 */
export function hhmmLabel(hhmm: string): string {
  const [rawHour, rawMinute] = hhmm.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const outOfRange = hour < 0 || hour > 23 || minute < 0 || minute > 59;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || outOfRange) return hhmm;
  return timeLabelShort(hour + minute / MINUTES_PER_HOUR);
}

/**
 * "since 7:42a" — and "since 7:42a on Jul 23" when the running segment did not start today.
 *
 * The date is not decoration. A punch left open overnight is the commonest way a timesheet goes
 * wrong, and "since 7:42a" on a Tuesday morning for a Monday-evening punch reads as normal. Naming
 * the day is what makes the mistake visible to the person who can fix it.
 */
export function sinceLabel(open: OpenEntryView, today: string): string {
  const time = hhmmLabel(open.startTime);
  if (open.workDate === today) return `since ${time}`;
  // Noon anchors the parse away from both DST boundaries. `workDate` is the shop's local date and
  // `today` the device's, so these can disagree for an hour around midnight in a travelling
  // technician's phone — naming the day is still the honest answer when they do.
  const day = new Date(`${open.workDate}T12:00:00`);
  if (Number.isNaN(day.getTime())) return `since ${time}`;
  return `since ${time} on ${day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** The row, from whatever the server says is running. */
export function dayClockView(open: OpenEntryView | null | undefined, today: string): DayClockView {
  if (open == null) return { state: "off", title: TITLE.off, since: "" };
  const state: DayClockState = open.kind === "break" ? "break" : "on";
  return { state, title: TITLE[state], since: sinceLabel(open, today) };
}

/**
 * What the row shows the instant a button is pressed, before the server has answered.
 *
 * A prediction, not a decision: the domain may legitimately refuse or no-op a tap, and the reply
 * replaces this outright. It exists because a punch clock that takes a round-trip to acknowledge a
 * press gets pressed twice.
 */
export function optimisticView(tap: DayClockTap, at: Date): DayClockView {
  const state = STATE_AFTER_TAP[tap];
  if (state === "off") return { state, title: TITLE.off, since: "" };
  const now = timeLabelShort(at.getHours() + at.getMinutes() / MINUTES_PER_HOUR);
  return { state, title: TITLE[state], since: `since ${now}` };
}
