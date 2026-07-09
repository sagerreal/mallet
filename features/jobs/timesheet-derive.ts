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
