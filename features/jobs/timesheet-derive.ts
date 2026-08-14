/**
 * features/jobs/timesheet-derive.ts
 * Pure timesheet math + labels (week math, worked/paid hours, weekly rollup, row labels, picker
 * options). No React, no store — unit-testable.
 *
 * The PAID-HOURS policy (break is the only unpaid kind) lives here. The OVERTIME rule does not: it
 * is shared with the technician's own My hours screen (features/timesheets/overtime.ts), because
 * this grid and that screen must never state different overtime for the same week.
 */

import type { Job, Lead, TimeEntry } from "@/lib/store/types";
import { timeToH, hToTime } from "@/lib/time";
import {
  overtimeSplit,
  overtimeRulePhrase,
  FEDERAL_OVERTIME_POLICY,
  type OvertimePolicy,
} from "@/features/timesheets/overtime";
import { custName } from "./jobs-helpers";
import {
  TS_KINDS,
  TS_TIME_OFF_DEFAULT_MINUTES,
  tsIsTimeOffKind,
  TIMESHEET_PICKER_MIN_HOUR,
  TIMESHEET_PICKER_MAX_HOUR,
  TIME_PICKER_STEP_HOURS,
  MAX_PLAUSIBLE_BREAK_HOURS,
  MAX_PLAUSIBLE_SEGMENT_HOURS,
} from "./timesheet-constants";

const HOURS_PER_DAY_ROLL = 24;
const CENTS = 100;

/** ISO date + n days. */
export function tsAddDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`. */
export function tsWeekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return tsAddDays(iso, -dow);
}

/** The 7 ISO dates of the week starting `mon` (Mon..Sun). */
export function tsWeekDates(mon: string): string[] {
  return Array.from({ length: 7 }, (_, i) => tsAddDays(mon, i));
}

/** Rounds money/hours to 2dp. */
export function tsMoney(n: number): number {
  return Math.round((Number(n) || 0) * CENTS) / CENTS;
}

/**
 * Is this row paid time off? It carries a LENGTH and no clock stamps.
 *
 * Delegates to the ONE list of time-off kinds (timesheet-constants.ts). Two lists of the same four
 * kinds is how a fifth one gets added to a picker and silently keeps creating overtime.
 */
export function tsIsTimeOff(e: TimeEntry): boolean {
  return tsIsTimeOffKind(e.kind);
}

/**
 * Recorded length for one entry, in hours.
 *
 * A TIME-OFF row carries its length directly — there are no punch times to a day off, so the
 * start/end subtraction below returns nothing for it. Without this branch a technician's holiday
 * totalled ZERO on the office grid: eight paid hours invisible on the screen where the week is
 * approved and pushed to QuickBooks.
 */
export function tsHours(e: TimeEntry): number {
  if (!e) return 0;
  if (e.minutes != null) return Math.round((e.minutes / 60) * CENTS) / CENTS;
  if (!e.end || !e.start) return 0;
  const d = timeToH(e.end) - timeToH(e.start);
  return d > 0 ? Math.round(d * CENTS) / CENTS : 0;
}

/** Paid hours — unpaid break excluded. */
export function tsPaid(e: TimeEntry): number {
  return e.kind === "break" ? 0 : tsHours(e);
}

/** Paid hours that were actually WORKED — the only hours that can create overtime. */
export function tsWorked(e: TimeEntry): number {
  return tsIsTimeOff(e) ? 0 : tsPaid(e);
}

/**
 * Paid hours that are attributed to an ACTUAL JOB — the only hours job costing can use.
 *
 * `kind === "job"` is not enough on its own. An entry can be a job entry with no job on it (the
 * office sees it as "— no job —"), which is time somebody was paid for and that no job can be
 * charged. Counting it would put hours into a costing report that belong to nothing, so it counts
 * as shift time here — which is the true statement — and the gap between the two figures is the
 * thing worth seeing.
 *
 * Everything else — shop, travel, breaks, time off — is shift time. Paid, and not on a job.
 */
export function tsJobHours(entries: TimeEntry[]): number {
  return tsMoney(
    entries.reduce((sum, e) => (e.kind === "job" && e.jobId ? sum + tsPaid(e) : sum), 0),
  );
}

/**
 * An entry nobody has ended: the clock is still running on it, or an end time was never recorded.
 * Either way it has no duration, so it totals as zero and cannot be signed for — which is why the
 * server refuses to approve a week containing one (ApproveWeekUseCase, tagged UNFINISHED_DAYS).
 *
 * TIME OFF IS NEVER UNFINISHED. A day off has no end time by construction, so the bare `!e.end`
 * test called every holiday an unfinished day: the grid warned the office to go fix a row that was
 * already complete, and named a day nobody could finish. Same kind-blindness the server's approval
 * predicate had before #457 — fixed there, and this is its mirror on the client.
 */
export function tsIsUnfinished(e: TimeEntry): boolean {
  if (tsIsTimeOff(e)) return false;
  return e.running === true || !e.end;
}

/**
 * A finished row whose duration is implausible for the kind of time it records — so it is probably a
 * segment somebody forgot to end, not a measurement.
 *
 * Two cases, and the break one is the reason this exists. A break is the ONLY unpaid kind, so a
 * break left running swallows the afternoon: the tech taps Break at noon, works the rest of the day,
 * and the row reads as five unpaid hours. Nothing else catches it — the row is FINISHED, so
 * tsIsUnfinished is false, the still-open banner never fires, and approveWeek accepts it. The
 * technician is simply short-paid, and the only visible symptom is a small weekly total.
 *
 * The paid case catches the mirror: a segment closed by the clock's bounded stale rule, whose hours
 * are an estimate rather than measured time.
 *
 * This flags for a human; it never changes a number.
 */
export function tsIsImplausible(e: TimeEntry): boolean {
  if (tsIsUnfinished(e)) return false;
  const hours = tsHours(e);
  return e.kind === "break"
    ? hours > MAX_PLAUSIBLE_BREAK_HOURS
    : hours > MAX_PLAUSIBLE_SEGMENT_HOURS;
}

/** This tech's entries for the given week. */
export function tsWeekEntries(entries: TimeEntry[], techId: string, weekDates: string[]): TimeEntry[] {
  return entries.filter((e) => e.techId === techId && weekDates.includes(e.date));
}

/** Time-sorted copy. */
export function tsSortEntries(es: TimeEntry[]): TimeEntry[] {
  return es
    .slice()
    .sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : timeToH(a.start ?? "00:00") - timeToH(b.start ?? "00:00"),
    );
}

export interface TsRollup {
  paid: number;
  reg: number;
  ot: number;
  approved: boolean;
  count: number;
  /** Names the overtime rule these figures were computed with — it differs by state. */
  rulePhrase: string;
}

/**
 * Weekly rollup — HOURS only, payroll computes pay.
 *
 * THE OVERTIME FIGURE OBEYS THE SHOP'S RULE. This function used to cap regular at a compiled-in
 * forty and call everything past it overtime, which was wrong three ways on the one screen where
 * hours are approved and pushed to QuickBooks:
 *
 *   - a daily-overtime state (California pays past EIGHT HOURS IN A DAY) got no daily overtime at
 *     all, so four ten-hour days reported zero where the man was owed eight hours;
 *   - PAID TIME OFF pushed people into overtime. It is paid but not worked, so it cannot: 40 worked
 *     plus an 8-hour holiday reported 8h of overtime that nobody had earned;
 *   - REGULAR was capped at the threshold, which states a SMALLER number than the shop is about to
 *     pay. That same 48-hour week showed 40 regular.
 *
 * The arithmetic is shared with the technician's own screen (features/timesheets/overtime.ts) so the
 * figure a man reads and the figure his employer approves cannot disagree.
 */
export function tsRollup(
  entries: TimeEntry[],
  techId: string,
  weekDates: string[],
  policy: OvertimePolicy = FEDERAL_OVERTIME_POLICY,
): TsRollup {
  const es = tsWeekEntries(entries, techId, weekDates);
  const paid = tsMoney(es.reduce((s, e) => s + tsPaid(e), 0));

  // Overtime is per-DAY then per-week, and only WORKED hours are eligible.
  const workedByDate = new Map<string, number>();
  for (const e of es) {
    const worked = tsWorked(e);
    if (worked > 0) workedByDate.set(e.date, (workedByDate.get(e.date) ?? 0) + worked);
  }
  const ot = tsMoney(overtimeSplit([...workedByDate.values()], policy).total);

  const approved = es.length > 0 && es.every((e) => e.status === "approved");
  // Uncapped, and including paid time off: every paid hour that is not overtime.
  return { paid, reg: tsMoney(paid - ot), ot, approved, count: es.length, rulePhrase: overtimeRulePhrase(policy) };
}

/**
 * The times a row gets when the office converts a day off back into worked time. A standard day, so
 * the row is immediately valid — and plainly wrong-looking if it is wrong, never a silent zero.
 */
export const TS_CONVERT_DEFAULT_START = "08:00";
export const TS_CONVERT_DEFAULT_END = "16:00";

/**
 * Everything that has to change when the office changes a row's KIND.
 *
 * The two shapes are mutually exclusive by database constraint (`time_entries_kind_shape_check`): a
 * clocked row carries start+end and no minutes, a day off carries minutes and no punch times. So
 * changing kind ACROSS that boundary has to rewrite the shape in the same breath — sending `kind`
 * alone would leave the old shape's columns populated, the domain would refuse the write, and the
 * office would be looking at a control that silently does nothing.
 *
 * Pure, and here rather than in the click handler, because this is the rule the database enforces and
 * it deserves to be read and tested as one.
 */
export function tsKindChange(entry: TimeEntry, kind: string): Partial<TimeEntry> {
  const wasOff = tsIsTimeOffKind(entry.kind);
  const nowOff = tsIsTimeOffKind(kind);
  if (nowOff === wasOff) return { kind };
  if (nowOff) {
    // Becoming a day off: the punch times go, because there are none to a day nobody worked.
    return { kind, start: null, end: null, running: false, minutes: TS_TIME_OFF_DEFAULT_MINUTES };
  }
  // Becoming worked time: it needs times, and a running flag must not survive the change.
  return {
    kind,
    minutes: null,
    start: TS_CONVERT_DEFAULT_START,
    end: TS_CONVERT_DEFAULT_END,
    running: false,
  };
}

/**
 * The days of this week whose hours are still unfinished, in week order.
 *
 * Mirrors the server's approval predicate (draft rows that are running or have no end time) so the
 * grid can name the days BEFORE the office reads a refusal — the same list the server would send
 * back, derived from the rows already on screen.
 */
export function tsUnfinishedDays(entries: TimeEntry[], techId: string, weekDates: string[]): string[] {
  const days = new Set(
    tsWeekEntries(entries, techId, weekDates)
      .filter((e) => e.status !== "approved" && tsIsUnfinished(e))
      .map((e) => e.date),
  );
  return weekDates.filter((d) => days.has(d));
}

const techHasVisitOn = (jobs: Job[], techId: string, date: string): boolean =>
  jobs.some(
    (j) => !j.archived && (j.visits ?? []).some((v) => v.techId === techId && v.date === date),
  );

/**
 * Days this crew member was scheduled on a job and recorded no hours at all, in week order.
 *
 * A grid that renders only what exists shows an absent day and a genuinely idle day identically —
 * silence reads as zero and zero reads as fine. These are the days the office has to ask about.
 */
export function tsUnrecordedDays(
  jobs: Job[],
  techId: string,
  weekDates: string[],
  entries: TimeEntry[],
): string[] {
  const recorded = new Set(tsWeekEntries(entries, techId, weekDates).map((e) => e.date));
  return weekDates.filter((d) => !recorded.has(d) && techHasVisitOn(jobs, techId, d));
}

export function tsJob(e: TimeEntry, jobs: Job[]): Job | undefined {
  return e.jobId != null ? jobs.find((j) => j.id === e.jobId) : undefined;
}

const TS_KIND_LABELS: Record<string, string> = {
  travel: "Travel between jobs",
  break: "Lunch / break",
  shop: "Shop · load-out & restock",
};

/** Row label — job title · customer, or the fixed label for non-job kinds. */
export function tsLabel(e: TimeEntry, jobs: Job[], leads: Lead[]): string {
  if (e.kind === "job") {
    const j = tsJob(e, jobs);
    if (!j) return "Job";
    const cn = custName(j, leads);
    return cn && cn !== "—" ? `${j.title} · ${cn}` : j.title;
  }
  return TS_KIND_LABELS[e.kind] ?? TS_KINDS[e.kind] ?? e.kind;
}

/** 12h label from decimal hours: 13.5 → "1:30pm". */
export function tsT12(h: number): string {
  if (h == null || Number.isNaN(h)) return "";
  let hr = Math.floor(h);
  let mn = Math.round((h - hr) * 60);
  if (mn === 60) {
    hr++;
    mn = 0;
  }
  const ap = hr % HOURS_PER_DAY_ROLL < 12 ? "am" : "pm";
  let d = hr % 12;
  if (d === 0) d = 12;
  return `${d}:${String(mn).padStart(2, "0")}${ap}`;
}

/**
 * A day named for a human: "Thu Jul 2" (long: "Thursday, Jul 2"). One helper so a day header and
 * the copy pointing at that day never name it two different ways.
 */
export function tsDayLabel(iso: string, weekday: "short" | "long" = "short"): string {
  // Noon, so a UTC-negative timezone can't shift the parsed instant back onto the previous day.
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday,
    month: "short",
    day: "numeric",
  });
}

/** Compact weekday + date for the seven-across day picker: "Mon 20". Same noon parse as
 *  tsDayLabel, for the same reason — a UTC-negative timezone would otherwise shift the date back
 *  onto the previous day. */
export function tsDayShort(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  // Composed rather than asking toLocaleDateString for both parts: with {weekday, day} some
  // locales render "22 Wed", and a day picker whose seven labels start with a number is unreadable
  // at a glance. The weekday name still follows the reader's locale.
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}

/** 12h label from an "HH:MM" string. */
export function tsTimeLabel(str: string | null): string {
  return str ? tsT12(timeToH(str)) : "";
}

export interface TsTimeOpt {
  h: number;
  t: string;
  label: string;
}

/** Picker options across the timesheet window, at the configured step. */
export function tsTimeOpts(): TsTimeOpt[] {
  const out: TsTimeOpt[] = [];
  for (
    let h = TIMESHEET_PICKER_MIN_HOUR;
    h <= TIMESHEET_PICKER_MAX_HOUR + 0.0001;
    h = Math.round((h + TIME_PICKER_STEP_HOURS) * CENTS) / CENTS
  ) {
    out.push({ h, t: hToTime(h), label: tsT12(h) });
  }
  return out;
}

/** Job ids this tech is scheduled on this week. */
export function tsTechWeekJobIds(jobs: Job[], techId: string, weekDates: string[]): Set<string> {
  const ids = new Set<string>();
  jobs.forEach((j) => {
    if (j.archived) return;
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date != null && weekDates.includes(v.date)) ids.add(j.id);
    });
  });
  return ids;
}
