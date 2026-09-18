/**
 * features/jobs/timesheet-grid-export.ts
 * The crew week as CSV.
 *
 * Payroll is run somewhere else — QuickBooks for shops that connected it, a bureau or a spreadsheet
 * for everyone else. Without this the way hours leave Mallet is retyping them, which is both the
 * slowest step of the week and the one where a digit changes.
 *
 * EXPORTS WHAT IS ON SCREEN, not everything. A filtered grid that exports the unfiltered set hands
 * back a file that disagrees with the thing the user was looking at when they pressed the button.
 */

import type { TsCrewRow, TsRowStatus } from "./timesheet-grid-derive";


/** "Mon". Parsed at noon so a UTC-negative zone cannot shift the date onto the previous day. */
function weekdayShort(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}

const STATUS_TEXT: Record<TsRowStatus, string> = {
  review: "Needs review",
  submitted: "Submitted",
  approved: "Approved",
  empty: "Nothing reported",
};

/**
 * One CSV field.
 *
 * Quoted whenever it holds a comma, a quote or a newline, with inner quotes doubled — the RFC 4180
 * rule. A technician called "Rivas, Carlos" is not hypothetical, and an unquoted comma silently
 * shifts every column after it, which in a payroll file means paying somebody another man's hours.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The crew grid as CSV text.
 *
 * Day columns carry their full date, not just "Mon 10" — a file opened three weeks later has to
 * say which week it is, and the range in the filename is not attached to the rows.
 *
 * A day nobody reported exports EMPTY, not 0. Zero is a claim that somebody worked no hours; empty
 * is the absence of a claim, and payroll treats the two differently.
 */
export function tsRowsToCsv(rows: readonly TsCrewRow[], weekDates: readonly string[]): string {
  const head = [
    "Technician",
    // `Mon 2026-08-10`: the weekday is what a human scans, the ISO date is what makes the file
    // unambiguous three weeks later and what a spreadsheet parses as a date. tsDayShort would add
    // the day number a second time ("Mon 10 2026-08-10").
    ...weekDates.map((d) => `${weekdayShort(d)} ${d}`),
    "Regular",
    "Overtime",
    "Total",
    "Issues",
    "Status",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      ...r.dayHours.map((h) => (h === null ? "" : h.toFixed(2))),
      // Regular is the uncapped remainder, matching the figure the grid and the technician's own
      // screen both show — never "capped at the threshold", which understates what is being paid.
      (r.paid - r.ot).toFixed(2),
      r.ot.toFixed(2),
      r.paid.toFixed(2),
      r.issues === 0 ? "" : String(r.issues),
      STATUS_TEXT[r.status],
    ]
      .map(csvField)
      .join(","),
  );
  return [head.map(csvField).join(","), ...lines].join("\r\n");
}

/** `timesheets-2026-08-10.csv` — the week it covers, in a form that sorts. */
export function tsCsvFilename(weekStart: string): string {
  return `timesheets-${weekStart}.csv`;
}
