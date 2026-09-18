/**
 * features/jobs/timesheet-grid-derive.ts
 * One row per technician for the office crew grid — the whole week, at a glance.
 *
 * WHY A ROW MODEL AND NOT JUST MORE RENDER CODE. The grid answers four questions per person at
 * once: how many hours, how much of it overtime, is anything wrong, and where does it stand. Each
 * has its own rule, and three of them already existed as tested functions used by the technician's
 * own screen. Deriving here keeps the grid a presentational leaf and keeps the figure an approver
 * reads identical to the one the man reads.
 *
 * Everything is computed from entries ALREADY in the store — the week query loads the whole org's
 * week, not one technician's — so drawing the crew costs no extra fetch.
 */

import type { TimeEntry } from "@/lib/store/types";
import type { OvertimePolicy } from "@/features/timesheets/overtime";
import { FEDERAL_OVERTIME_POLICY } from "@/features/timesheets/overtime";
import { tsPaid, tsWorked, tsRollup, tsUnfinishedDays, tsIsImplausible, tsWeekEntries } from "./timesheet-derive";

/**
 * Where a week stands, in the order an approver works through them.
 *
 * `empty` is deliberately its OWN state rather than a zero. A man with no hours has not "worked a
 * zero-hour week" — nothing has been reported, which is a different fact and a different action.
 */
export type TsRowStatus = "review" | "submitted" | "approved" | "empty";

export interface TsCrewRow {
  readonly techId: string;
  readonly name: string;
  /** Two letters for the avatar; falls back to one when the name is a single word. */
  readonly initials: string;
  /** Paid hours per weekday, Monday first. `null` means nothing was reported that day. */
  readonly dayHours: readonly (number | null)[];
  /** Indices of dayHours that broke the shop's DAILY overtime rule — the amber cells. */
  readonly otDays: ReadonlySet<number>;
  readonly paid: number;
  readonly ot: number;
  /** Days needing a human before this week can be approved. 0 renders as a dash, never "0". */
  readonly issues: number;
  readonly status: TsRowStatus;
}

/** Initials for the avatar. "Carlos Rivas" → CR, "owenduggan" → OW. */
export function tsInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

/** Paid hours for one technician on each date, `null` where nothing was reported. */
export function tsDayHours(
  entries: TimeEntry[],
  techId: string,
  weekDates: string[],
): (number | null)[] {
  const byDate = new Map<string, number>();
  for (const e of tsWeekEntries(entries, techId, weekDates)) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + tsPaid(e));
  }
  // Rounded per day, not at the end: these are the figures on screen, and a column that does not
  // sum to the total it sits beside reads as a bug even when the underlying arithmetic is right.
  return weekDates.map((d) => {
    const v = byDate.get(d);
    return v === undefined ? null : Math.round(v * 100) / 100;
  });
}

/**
 * Which days broke the DAILY overtime rule.
 *
 * Only worked hours count — paid time off is paid but not worked and cannot earn overtime, the same
 * rule tsRollup applies to the weekly figure. A shop on the federal floor has no daily rule at all,
 * so this is empty and no cell is highlighted; that is correct, not a missing feature.
 */
export function tsOtDays(
  entries: TimeEntry[],
  techId: string,
  weekDates: string[],
  policy: OvertimePolicy,
): Set<number> {
  const out = new Set<number>();
  const dailyMin = policy.dailyThresholdMinutes;
  if (dailyMin === null) return out;
  const threshold = dailyMin / 60;
  const worked = new Map<string, number>();
  for (const e of tsWeekEntries(entries, techId, weekDates)) {
    const w = tsWorked(e);
    if (w > 0) worked.set(e.date, (worked.get(e.date) ?? 0) + w);
  }
  weekDates.forEach((d, i) => {
    if ((worked.get(d) ?? 0) > threshold) out.add(i);
  });
  return out;
}

/**
 * Days an approver has to look at before this week can go anywhere.
 *
 * Unfinished spans (a clock that never stopped) and implausible ones are counted TOGETHER as a
 * single number, because the column exists to say "this row needs you", not to categorise. The
 * drill-down names the actual problem.
 */
export function tsIssueCount(entries: TimeEntry[], techId: string, weekDates: string[]): number {
  const unfinished = new Set(tsUnfinishedDays(entries, techId, weekDates));
  for (const e of tsWeekEntries(entries, techId, weekDates)) {
    if (tsIsImplausible(e)) unfinished.add(e.date);
  }
  return unfinished.size;
}

/** Where the week stands. Approved outranks submitted; nothing reported is its own state. */
export function tsRowStatus(approved: boolean, count: number, submitted: boolean): TsRowStatus {
  if (count === 0) return "empty";
  if (approved) return "approved";
  return submitted ? "submitted" : "review";
}

export interface TsCrewRowsArgs {
  readonly entries: TimeEntry[];
  readonly techs: readonly { id: string; name: string }[];
  readonly weekDates: string[];
  readonly policy?: OvertimePolicy;
  /** Tech ids whose week has been signed off by the technician and not reopened. */
  readonly submittedTechIds: ReadonlySet<string>;
}

/**
 * One row per technician, in the order the crew is given.
 *
 * EVERY technician gets a row, including those with no hours. Dropping them would make the grid
 * agree with itself and disagree with payroll — "who has not reported yet" is the question this
 * screen exists to answer, and an absent row answers it by omission, which nobody reads.
 */
export function tsCrewRows({
  entries,
  techs,
  weekDates,
  policy = FEDERAL_OVERTIME_POLICY,
  submittedTechIds,
}: TsCrewRowsArgs): TsCrewRow[] {
  return techs.map((t) => {
    const rollup = tsRollup(entries, t.id, weekDates, policy);
    return {
      techId: t.id,
      name: t.name,
      initials: tsInitials(t.name),
      dayHours: tsDayHours(entries, t.id, weekDates),
      otDays: tsOtDays(entries, t.id, weekDates, policy),
      paid: rollup.paid,
      ot: rollup.ot,
      issues: tsIssueCount(entries, t.id, weekDates),
      status: tsRowStatus(rollup.approved, rollup.count, submittedTechIds.has(t.id)),
    };
  });
}

/** The chip filters above the grid. `all` is not a filter, it is the absence of one. */
export type TsGridFilter = "all" | "review" | "issues" | "approved";

/** Counts for the chips — computed from the same rows the grid renders, never a second query. */
export function tsGridCounts(rows: readonly TsCrewRow[]): Record<TsGridFilter, number> {
  return {
    all: rows.length,
    review: rows.filter((r) => r.status === "review" || r.status === "submitted").length,
    issues: rows.filter((r) => r.issues > 0).length,
    approved: rows.filter((r) => r.status === "approved").length,
  };
}

/** Chip + search applied together. Search matches the name only — it is a crew list. */
export function tsFilterRows(
  rows: readonly TsCrewRow[],
  filter: TsGridFilter,
  query: string,
): TsCrewRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q.length > 0 && !r.name.toLowerCase().includes(q)) return false;
    if (filter === "review") return r.status === "review" || r.status === "submitted";
    if (filter === "issues") return r.issues > 0;
    if (filter === "approved") return r.status === "approved";
    return true;
  });
}
