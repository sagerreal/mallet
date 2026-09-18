/**
 * features/field/hours-sheet-derive.ts
 * The My hours sheet, derived — pure. No React, no store, no clock: the caller supplies its own
 * "today" and the shop's own overtime policy, so every figure here is testable and none of it
 * depends on where it is rendered.
 *
 * TWO GRAINS, AND THEY ARE NOT THE SAME. `runsForDay` (my-hours-runs.ts) splits a day at every
 * break, because it answers "what stretches did I work". A SHEET ROW answers a different question
 * — "what shift did the clock record" — so it spans its breaks and splits only where the
 * technician actually went off the clock. Clock out at noon and back on at six and that is two
 * rows, because merging them would invent a shift he never worked; the row's break columns hold
 * one pause, and a made-up 07:30–20:00 shift is exactly the fiction this file exists to avoid.
 *
 * The other grain is TIME OFF, which has no times at all — a date and a length. It is paid, so it
 * belongs in the week's regular figure; it is not worked, so it can never create overtime.
 */

import { entryHours, isPaidKind, paidHours, sortByStart, type MyHoursEntry } from "./my-hours-derive";
import {
  overtimeSplit,
  overtimeRulePhrase,
  type OvertimePolicy,
} from "@/features/timesheets/overtime";

export type { MyHoursEntry };
// Re-exported so this module stays the one import My hours needs; the rule itself is shared with
// the office grid and lives in features/timesheets/overtime.ts.
export { overtimeSplit, overtimeRulePhrase };
export type { OvertimePolicy, OvertimeSplit } from "@/features/timesheets/overtime";

/** The four kinds that are paid absence rather than recorded work. */
export const TIME_OFF_KINDS = ["pto", "vacation", "sick", "holiday"] as const;
export type TimeOffKind = (typeof TIME_OFF_KINDS)[number];

const isTimeOff = (kind: string): kind is TimeOffKind =>
  (TIME_OFF_KINDS as readonly string[]).includes(kind);

export interface SheetBreak {
  readonly startTime: string;
  readonly endTime: string | null;
  readonly hours: number;
}

/** Where a row's times came from. `mixed` is honest about a tapped shift somebody hand-edited. */
export type RowSource = "clock" | "manual" | "timer" | "mixed";

/** One clock session, as the sheet's register renders it. */
export interface ShiftRow {
  /** Stable across renders: the first entry's id. */
  readonly key: string;
  readonly workDate: string;
  readonly startTime: string;
  /** Null while the shift is still running. */
  readonly endTime: string | null;
  readonly running: boolean;
  /** Every pause inside this shift, in order. The register shows the first and counts the rest. */
  readonly breaks: readonly SheetBreak[];
  readonly breakHours: number;
  /** PAID hours: the whole session less its breaks. */
  readonly hours: number;
  readonly src: RowSource;
  /** Every row this shift merged — what the detail view expands to and what an edit targets. */
  readonly entries: readonly MyHoursEntry[];
}

/** One paid absence: a date, a kind and a length. */
export interface OffRow {
  readonly key: string;
  readonly workDate: string;
  readonly kind: TimeOffKind;
  readonly hours: number;
  readonly entry: MyHoursEntry;
}

type PunchedEntry = MyHoursEntry & { startTime: string };

const isPunched = (e: MyHoursEntry): e is PunchedEntry =>
  e.startTime !== null && !isTimeOff(e.kind);

/**
 * Do these two rows belong to one clock session?
 *
 * Touching clocks only — and deliberately WITHOUT the paid-ness test `runsForDay` applies, because
 * a break is inside its shift rather than a boundary of it. A GAP is real: he was off the clock,
 * and swallowing it would pay him for time he never recorded.
 */
const sameSession = (prev: MyHoursEntry, next: MyHoursEntry): boolean =>
  prev.endTime !== null && prev.endTime === next.startTime && prev.workDate === next.workDate;

const sourceOf = (entries: readonly MyHoursEntry[]): RowSource => {
  const [first, ...rest] = entries;
  const src = first?.src ?? "manual";
  return rest.every((e) => e.src === src) ? src : "mixed";
};

// Takes PunchedEntry, not MyHoursEntry: a break has punch times by definition, and typing the
// parameter is what makes that true instead of asserting it with a cast on `startTime`.
const breaksIn = (entries: readonly PunchedEntry[]): SheetBreak[] =>
  entries
    .filter((e) => !isPaidKind(e.kind))
    .map((e) => ({ startTime: e.startTime, endTime: e.endTime, hours: entryHours(e) }));

const toShiftRow = (group: readonly PunchedEntry[]): ShiftRow => {
  const first = group[0]!;
  const last = group[group.length - 1]!;
  const breaks = breaksIn(group);
  return {
    key: first.id,
    workDate: first.workDate,
    startTime: first.startTime,
    endTime: last.endTime,
    running: last.endTime === null,
    breaks,
    breakHours: breaks.reduce((sum, b) => sum + b.hours, 0),
    hours: group.reduce((sum, e) => sum + paidHours(e), 0),
    src: sourceOf(group),
    entries: group,
  };
};

/**
 * A week's punched entries as sheet rows — one per clock session, in the order they happened.
 * Input order is irrelevant: the server returns a day in (work_date, id) order, i.e. UUID order.
 *
 * ONE PERSON'S ENTRIES. Sessions merge on touching times, and two technicians who both clocked out
 * at noon would fuse into one impossible shift. `v1.timesheets.list` scopes to the caller on the
 * field surface, so the precondition holds where this is used; an office view over a crew has to
 * group by technician before calling in.
 */
export function shiftRows(entries: readonly MyHoursEntry[]): ShiftRow[] {
  const sorted = [...sortByStart(entries.filter(isPunched))].sort((a, b) =>
    a.workDate === b.workDate ? 0 : a.workDate < b.workDate ? -1 : 1,
  ) as PunchedEntry[];

  const sessions: PunchedEntry[][] = [];
  for (const entry of sorted) {
    const open = sessions[sessions.length - 1];
    const last = open?.[open.length - 1];
    // A running row closes its session: nothing can follow a stretch with no end.
    if (open && last && sameSession(last, entry)) open.push(entry);
    else sessions.push([entry]);
  }
  return sessions.map(toShiftRow);
}

/** A week's time-off entries as sheet rows, in date order. */
export function offRows(entries: readonly MyHoursEntry[]): OffRow[] {
  return entries
    .filter((e) => isTimeOff(e.kind))
    .map((entry) => ({
      key: entry.id,
      workDate: entry.workDate,
      kind: entry.kind as TimeOffKind,
      hours: entryHours(entry),
      entry,
    }))
    .sort((a, b) => (a.workDate < b.workDate ? -1 : a.workDate > b.workDate ? 1 : 0));
}

export interface MissingWorkdaysArgs {
  /** Each date's standard working length for THIS person; null or 0 means they do not work it. */
  readonly standardMinutesByDate: ReadonlyMap<string, number | null>;
  /** Recorded hours per date — worked and paid time off together, because both cover a day. */
  readonly hoursByDate: ReadonlyMap<string, number>;
  readonly todayISO: string;
}

/**
 * Workdays that have already passed with nothing recorded — the one timesheet gap worth
 * interrupting anyone about, because it is the one that silently shorts a paycheck.
 *
 * TODAY IS NEVER MISSING. A day still being worked cannot have been under-reported, and flagging
 * it every morning is how a warning teaches people to ignore warnings. A day this person does not
 * work is never missing either: the standard comes from their own crew-hours row, so a part-timer's
 * Friday off and a Saturday nobody works are simply not asked about.
 */
export function missingWorkdays(args: MissingWorkdaysArgs): string[] {
  const missing: string[] = [];
  for (const [date, standard] of args.standardMinutesByDate) {
    if (standard === null || standard <= 0) continue;
    if (date >= args.todayISO) continue;
    if ((args.hoursByDate.get(date) ?? 0) > 0) continue;
    missing.push(date);
  }
  return missing.sort();
}

export interface WeekSummary {
  /** Paid hours that are not overtime: worked straight time PLUS paid time off. Uncapped. */
  readonly regularHours: number;
  readonly overtimeHours: number;
  readonly timeOffHours: number;
  readonly workedHours: number;
  readonly breakHours: number;
  readonly missingDays: readonly string[];
  /** Names the overtime rule the figures were computed with. */
  readonly rulePhrase: string;
  /**
   * Is one of this week's shifts still on the clock?
   *
   * The figures above deliberately do NOT count it — an unfinished stretch is not yet hours, which
   * is the right answer for a timesheet and the wrong one for a man looking at his own day at 3pm.
   * My day measures that open stretch against now (features/field/day-segments.ts), so the two
   * screens legitimately state different totals for the same day. This is what lets the headline
   * say so, instead of leaving him to decide which screen is broken.
   */
  readonly shiftRunning: boolean;
}

export interface WeekSummaryArgs {
  readonly entries: readonly MyHoursEntry[];
  readonly policy: OvertimePolicy;
  readonly standardMinutesByDate: ReadonlyMap<string, number | null>;
  readonly todayISO: string;
}

/**
 * The three cells of the summary strip. ONE PERSON'S ENTRIES, for the reason `shiftRows` gives —
 * and here it also decides overtime, which is per-person by law and cannot be summed across a crew.
 *
 * REGULAR IS UNCAPPED on purpose. A technician who works a full forty and is paid for a holiday is
 * owed forty-eight regular hours; showing forty because that is the overtime threshold would state
 * a smaller number than the shop is about to pay, on the screen whose whole job is telling him
 * what he earned.
 */
export function weekSummary(args: WeekSummaryArgs): WeekSummary {
  const shifts = shiftRows(args.entries);
  const off = offRows(args.entries);

  const workedByDate = new Map<string, number>();
  for (const shift of shifts) {
    workedByDate.set(shift.workDate, (workedByDate.get(shift.workDate) ?? 0) + shift.hours);
  }
  const workedHours = [...workedByDate.values()].reduce((sum, h) => sum + h, 0);
  const breakHours = shifts.reduce((sum, s) => sum + s.breakHours, 0);
  const timeOffHours = off.reduce((sum, r) => sum + r.hours, 0);

  const overtime = overtimeSplit([...workedByDate.values()], args.policy);

  // A day is covered by hours OF EITHER KIND — a PTO day is reported, not missing.
  const hoursByDate = new Map(workedByDate);
  for (const r of off) hoursByDate.set(r.workDate, (hoursByDate.get(r.workDate) ?? 0) + r.hours);

  return {
    regularHours: workedHours - overtime.total + timeOffHours,
    overtimeHours: overtime.total,
    timeOffHours,
    workedHours,
    breakHours,
    missingDays: missingWorkdays({
      standardMinutesByDate: args.standardMinutesByDate,
      hoursByDate,
      todayISO: args.todayISO,
    }),
    rulePhrase: overtimeRulePhrase(args.policy),
    shiftRunning: shifts.some((s) => s.running),
  };
}
