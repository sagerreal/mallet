/**
 * features/field/my-hours-runs.ts
 * A technician's day as the stretches he would describe — pure.
 *
 * WHY THE KIND TAG IS GONE. `job` / `travel` / `shop` are payroll-IDENTICAL: `paidHours` returns
 * the full length for all three and zero only for `break`. Printing them on a payroll screen
 * asserts a distinction that does not exist for pay, and the man reading it has to work out that
 * none of the three labels changes what he is owed. What is left is the only split that does:
 * WORKED or BREAK.
 *
 * Dropping the tag is also what lets adjacent rows merge, and the merge is most of the value. A
 * chain of taps writes a row per transition, so a day reads as five or six fragments — including
 * the one-minute sliver left by a mis-tap, which looks like a defect and is really just a tap
 * corrected two seconds later. Merged, that day is "worked 10:46–1:51" and the sliver is inside
 * it, still there, still editable.
 *
 * NOTHING IS HIDDEN. A run keeps every row it merged; the surface expands to them, so a
 * correction is never more than one tap further away than it was.
 */

import { entryHours, isPaidKind, paidHours, sortByStart, type MyHoursEntry } from "./my-hours-derive";

export interface HoursRun {
  /** Stable across renders: the first entry's id. */
  readonly key: string;
  readonly paid: boolean;
  /** "Worked" or "Break" — the only distinction that changes what he is paid. */
  readonly label: string;
  readonly startTime: string;
  /** Null while the last row in the run is still running. */
  readonly endTime: string | null;
  /** Paid hours for the whole run. Zero for a break, by the same policy as a single row. */
  readonly hours: number;
  /** True when the run is still open — its last row has no end. */
  readonly running: boolean;
  /** Every row this run merged, in order. Length 1 is the ordinary case. */
  readonly entries: readonly MyHoursEntry[];
}

type PunchedEntry = MyHoursEntry & { startTime: string };

const labelFor = (paid: boolean): string => (paid ? "Worked" : "Break");

/**
 * Do these two rows describe one unbroken stretch?
 *
 * Both conditions matter. Same paid-ness, because merging worked time into a break would change
 * what the row claims he is owed. Touching clocks, because a GAP is real — he was off the clock,
 * and swallowing it into a single run would silently pay him for time he did not record.
 */
const continues = (prev: MyHoursEntry, next: MyHoursEntry): boolean =>
  prev.endTime !== null &&
  prev.endTime === next.startTime &&
  isPaidKind(prev.kind) === isPaidKind(next.kind);

/**
 * One day's rows, merged into runs. Input order is irrelevant — the server's intra-day order is
 * (work_date, id), i.e. UUID order, so this sorts by start first exactly as every other view does.
 */
export function runsForDay(entries: readonly MyHoursEntry[]): HoursRun[] {
  const sorted = sortByStart(entries);
  const runs: PunchedEntry[][] = [];

  // Time-off rows are not stretches of a day — they carry no times and cannot join a run.
  // The sheet renders them as their own kind of row, never here.
  //
  // JOB ROWS ARE NOT STRETCHES EITHER. A job row runs BESIDE the shift saying which job it was
  // spent on; it is costing, not paid time. Listing it as its own run would draw the same hour
  // twice — once as the shift and once as the job — and the totals would disagree with the row
  // they sit under. Which job is live is named from the row itself, not from this list.
  const punched = sorted.filter(
    (e): e is PunchedEntry => e.startTime !== null && e.kind !== "job",
  );
  for (const entry of punched) {
    const open = runs[runs.length - 1];
    const last = open?.[open.length - 1];
    // A running row ends its run: nothing can follow a stretch with no end.
    if (open && last && continues(last, entry)) open.push(entry);
    else runs.push([entry]);
  }

  return runs.map((group) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const paid = isPaidKind(first.kind);
    return {
      key: first.id,
      paid,
      label: labelFor(paid),
      startTime: first.startTime,
      endTime: last.endTime,
      hours: group.reduce((sum, e) => sum + paidHours(e), 0),
      running: last.endTime === null,
      entries: group,
    };
  });
}

/**
 * The recorded length of a run, paid or not — what to show against a break, where `hours` is
 * deliberately zero. A break with no figure at all reads as a row that failed to load.
 */
export function runLength(run: HoursRun): number {
  return run.entries.reduce((sum, e) => sum + entryHours(e), 0);
}
