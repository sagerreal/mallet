/**
 * features/field/my-hours-derive.ts
 * Pure week/hour maths for the technician's My hours surface — no React, no store, no network.
 *
 * My hours deliberately reads the server DTO straight rather than going through the office
 * Zustand store (which is only hydrated under the ownerOrOffice layout), so these helpers take
 * DTOs and return numbers and labels, nothing else.
 */

import { addDaysISO } from "@/lib/clock";
import { timeToH, timeLabelShort } from "@/lib/time";
import type { RouterOutputs } from "@/lib/trpc/client";

/** One row of the technician's own timesheet, exactly as the router returns it. */
export type MyHoursEntry = RouterOutputs["v1"]["timesheets"]["list"]["items"][number];

/** A calendar week. Week navigation moves by exactly this — never "about seven days". */
export const DAYS_PER_WEEK = 7;

/**
 * The hours after which this page LABELS the rest of the week overtime. Display only: FLSA
 * workweeks are employer-defined and this page hard-codes a Monday start, so the figure is a
 * hint for the technician, not a payroll calculation — Mallet deliberately sends no overtime
 * split to QuickBooks and lets payroll compute it.
 */
export const FULL_TIME_HOURS_PER_WEEK = 40;

/** Decimal places hours are shown at. Two, because that is what a payroll line item carries. */
export const HOURS_PRECISION = 2;

export const KIND_LABELS: Record<MyHoursEntry["kind"], string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
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

/** "07:42" → "7:42a". The technician reads a clock, not a 24-hour string. */
export function clockLabel(hhmm: string | null): string {
  return hhmm ? timeLabelShort(timeToH(hhmm)) : "—";
}

/** Recorded length in decimal hours. A running row has no end yet, so it counts as nothing. */
export function entryHours(entry: MyHoursEntry): number {
  if (!entry.endTime) return 0;
  return Math.max(0, timeToH(entry.endTime) - timeToH(entry.startTime));
}

/**
 * Paid length. Break is the only state inside the day that is unpaid — that single sentence is
 * the whole policy, and it is the one the office has to be able to defend.
 */
export function paidHours(entry: MyHoursEntry): number {
  return entry.kind === "break" ? 0 : entryHours(entry);
}

/** The entries falling inside the week beginning `weekStartISO`. */
export function weekEntries(
  entries: readonly MyHoursEntry[],
  weekStartISO: string,
): MyHoursEntry[] {
  const days = new Set(weekDates(weekStartISO));
  return entries.filter((e) => days.has(e.workDate));
}

/** The entries of one day, oldest start first — the order the day actually happened in. */
export function sortByStart(entries: readonly MyHoursEntry[]): MyHoursEntry[] {
  return [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export interface WeekRollup {
  readonly paid: number;
  readonly overtime: number;
}

export function rollup(entries: readonly MyHoursEntry[], weekStartISO: string): WeekRollup {
  const paid = weekEntries(entries, weekStartISO).reduce((sum, e) => sum + paidHours(e), 0);
  return { paid, overtime: Math.max(0, paid - FULL_TIME_HOURS_PER_WEEK) };
}

/** Group a week's entries by work date, each day's rows in the order they happened. */
export function byDay(entries: readonly MyHoursEntry[]): Map<string, MyHoursEntry[]> {
  const grouped = new Map<string, MyHoursEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.workDate, [...(grouped.get(entry.workDate) ?? []), entry]);
  }
  return new Map([...grouped].map(([date, rows]) => [date, sortByStart(rows)]));
}
