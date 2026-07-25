/**
 * features/jobs/timesheet-derive.ts
 * Pure timesheet math + labels (week math, worked/paid hours, weekly rollup,
 * row labels, picker options). No React, no store — unit-testable; the payroll
 * rules (paid-hours, the 40h overtime split) live here as the single source.
 */

import type { Job, Lead, TimeEntry } from "@/lib/store/types";
import { timeToH, hToTime } from "@/lib/time";
import { custName } from "./jobs-helpers";
import {
  TS_KINDS,
  FULL_TIME_HOURS_PER_WEEK,
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

/** Worked hours for one entry. */
export function tsHours(e: TimeEntry): number {
  if (!e || !e.end) return 0;
  const d = timeToH(e.end) - timeToH(e.start);
  return d > 0 ? Math.round(d * CENTS) / CENTS : 0;
}

/** Paid hours — unpaid break excluded. */
export function tsPaid(e: TimeEntry): number {
  return e.kind === "break" ? 0 : tsHours(e);
}

/**
 * An entry nobody has ended: the clock is still running on it, or an end time was never recorded.
 * Either way it has no duration, so it totals as zero and cannot be signed for — which is why the
 * server refuses to approve a week containing one (ApproveWeekUseCase, tagged UNFINISHED_DAYS).
 */
export function tsIsUnfinished(e: TimeEntry): boolean {
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
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : timeToH(a.start) - timeToH(b.start)));
}

export interface TsRollup {
  paid: number;
  reg: number;
  ot: number;
  approved: boolean;
  count: number;
}

/** Weekly rollup — HOURS only, payroll computes pay. */
export function tsRollup(entries: TimeEntry[], techId: string, weekDates: string[]): TsRollup {
  const es = tsWeekEntries(entries, techId, weekDates);
  const paid = tsMoney(es.reduce((s, e) => s + tsPaid(e), 0));
  const reg = Math.min(paid, FULL_TIME_HOURS_PER_WEEK);
  const ot = tsMoney(Math.max(0, paid - FULL_TIME_HOURS_PER_WEEK));
  const approved = es.length > 0 && es.every((e) => e.status === "approved");
  return { paid, reg, ot, approved, count: es.length };
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
