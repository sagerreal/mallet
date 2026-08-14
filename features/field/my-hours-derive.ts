/**
 * features/field/my-hours-derive.ts
 * Pure week/hour maths for the technician's My hours surface — no React, no store, no network.
 *
 * My hours deliberately reads the server DTO straight rather than going through the office
 * Zustand store (which is only hydrated under the ownerOrOffice layout), so these helpers take
 * DTOs and return numbers and labels, nothing else.
 */

import { addDaysISO } from "@/lib/clock";
import { timeToH, timeLabelShort, colLabel } from "@/lib/time";
import type { RouterOutputs } from "@/lib/trpc/client";

/** One row of the technician's own timesheet, exactly as the router returns it. */
export type MyHoursEntry = RouterOutputs["v1"]["timesheets"]["list"]["items"][number];

/** A calendar week. Week navigation moves by exactly this — never "about seven days". */
export const DAYS_PER_WEEK = 7;

/** Decimal places hours are shown at. Two, because that is what a payroll line item carries. */
export const HOURS_PRECISION = 2;

export const KIND_LABELS: Record<MyHoursEntry["kind"], string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  pto: "PTO",
  vacation: "Vacation",
  sick: "Sick",
  holiday: "Holiday",
  shop: "Regular",
};

// Midday anchor: parsing a bare YYYY-MM-DD lands on UTC midnight, which is the PREVIOUS day in
// every western zone — so a Monday would render as Sunday for the whole beachhead.
const noon = (iso: string): Date => new Date(`${iso}T12:00:00`);

/** The Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const dayOfWeek = (noon(iso).getDay() + 6) % DAYS_PER_WEEK; // 0 = Monday
  return addDaysISO(iso, -dayOfWeek);
}

/** The seven ISO dates of the week beginning `weekStartISO`, Monday first. */
export function weekDates(weekStartISO: string): string[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDaysISO(weekStartISO, i));
}

/** "Monday, Jul 20" — the day header. */
export function dayLabel(iso: string): string {
  return noon(iso).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** "Jul 20" — the week-range label. */
export function shortDayLabel(iso: string): string {
  return noon(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Mon 8/4" — the register's date column, which is narrow and read down rather than across.
 *  The weekday leads because that is what a man remembers; the date settles which one it was. */
export function sheetDayLabel(iso: string): string {
  const d = noon(iso);
  return `${colLabel(iso)} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** "07:42" → "7:42a". The technician reads a clock, not a 24-hour string. */
export function clockLabel(hhmm: string | null): string {
  return hhmm ? timeLabelShort(timeToH(hhmm)) : "—";
}

/** Recorded length in decimal hours. A running row has no end yet, so it counts as nothing;
 *  a time-off row carries its length directly — there are no punch times to a day off. */
export function entryHours(entry: MyHoursEntry): number {
  // Loose null check on purpose: older callers/fixtures may omit the key entirely, and an
  // absent length must read as "clocked row", never as NaN time off.
  if (entry.minutes != null) return entry.minutes / 60;
  if (!entry.endTime || !entry.startTime) return 0;
  return Math.max(0, timeToH(entry.endTime) - timeToH(entry.startTime));
}

/**
 * THE UNPAID-KIND POLICY, and the only place it is written down. Break is the only state inside
 * the day that is unpaid — that single sentence is the whole policy, and it is the one the office
 * has to be able to defend.
 *
 * It is the KIND test rather than the hours that is exported, because the day panel needs the same
 * policy over a different length: `paidHours` runs through `entryHours`, which returns 0 for a
 * running row, and the panel has to count the stretch the technician is standing in
 * (features/field/day-segments.ts). Sharing the sentence and not the sum is what keeps My hours
 * and the day panel from disagreeing when a second unpaid kind is added.
 */
/**
 * JOB TIME IS NOT PAID TIME.
 *
 * A job row records WHICH JOB part of a shift was spent on — costing, not time tracking — and it
 * runs BESIDE the regular time it describes rather than replacing a slice of it. The shift is what
 * pays. Counting both would pay a twelve-hour day as fifteen the moment three of its hours were
 * attributed to a job.
 *
 * Breaks are unpaid for the ordinary reason.
 */
export function isPaidKind(kind: MyHoursEntry["kind"]): boolean {
  return kind !== "break" && kind !== "job";
}

/** Paid recorded length — the policy above, applied to a settled row. */
export function paidHours(entry: MyHoursEntry): number {
  return isPaidKind(entry.kind) ? entryHours(entry) : 0;
}

/** The entries falling inside the week beginning `weekStartISO`. */
export function weekEntries(
  entries: readonly MyHoursEntry[],
  weekStartISO: string,
): MyHoursEntry[] {
  const days = new Set(weekDates(weekStartISO));
  return entries.filter((e) => days.has(e.workDate));
}

/** The entries of one day, oldest start first — the order the day actually happened in.
 *  Time-off rows have no start; they read first, before the day's punches. */
export function sortByStart(entries: readonly MyHoursEntry[]): MyHoursEntry[] {
  return [...entries].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** Group a week's entries by work date, each day's rows in the order they happened. */
export function byDay(entries: readonly MyHoursEntry[]): Map<string, MyHoursEntry[]> {
  const grouped = new Map<string, MyHoursEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.workDate, [...(grouped.get(entry.workDate) ?? []), entry]);
  }
  return new Map([...grouped].map(([date, rows]) => [date, sortByStart(rows)]));
}
