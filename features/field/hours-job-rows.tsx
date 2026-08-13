"use client";

/**
 * features/field/hours-job-rows.tsx
 * What a shift's hours were spent on: the jobs, from the visit taps, under the shift they belong to.
 *
 * THE COLUMN THAT IS NOT HERE is a running total the shift has to match. Job time does not sum to
 * the shift and is not meant to — drive time is paid and belongs to no job, a shop morning has no
 * visit at all — so the panel EXPLAINS the difference in a sentence and never balances it into a
 * row. See features/field/job-time-derive.ts.
 *
 * A visit nobody stamped still appears, saying so. Dropping it is how a missing tap becomes
 * invisible, and a missing tap is the only thing on this panel anybody needs to act on.
 */

import { HOURS_PRECISION } from "./my-hours-derive";
import {
  jobTimeForDate,
  jobTimeTotals,
  jobTimeGapNote,
  type JobTimeRow,
  type VisitStamp,
} from "./job-time-derive";

/** The job cell: what he calls the job, and who it was for. */
function JobCell({ row }: { row: JobTimeRow }) {
  return (
    <span className="shd-who">
      <b>{row.jobTitle ?? row.jobNum}</b>
      {/* The number when the title already carries the name, so the row is still findable in the
          office's book; the customer when there is one. */}
      <span className="shd-cust">
        {row.jobTitle ? `${row.jobNum}${row.customerName ? ` · ${row.customerName}` : ""}` : (row.customerName ?? "—")}
      </span>
    </span>
  );
}

function JobRow({ row }: { row: JobTimeRow }) {
  return (
    <div className="shd-row">
      <JobCell row={row} />
      <span className="shd-t">{row.startLabel}</span>
      <span className="shd-t">{row.running ? "on this job" : row.endLabel}</span>
      <span className="shd-d">
        {row.hours === null ? (
          // Absent, not zero: zero would claim he was there and it took no time. And it names the
          // tap that is missing, because that is the part he can do something about.
          <span className="shd-un">
            {row.missing === "arrival" ? "no arrival" : row.missing === "both" ? "not stamped" : "—"}
          </span>
        ) : (
          <>
            {row.hours.toFixed(HOURS_PRECISION)}
            <span className="u">h</span>
          </>
        )}
      </span>
    </div>
  );
}

export interface HoursJobRowsProps {
  readonly stamps: readonly VisitStamp[];
  readonly workDate: string;
  /** The shift's own paid hours — used only to EXPLAIN the difference, never to reconcile it. */
  readonly shiftHours: number;
  /** True while the shift is running: its own total is not final, so no gap can be stated yet. */
  readonly shiftRunning: boolean;
}

export function HoursJobRows({ stamps, workDate, shiftHours, shiftRunning }: HoursJobRowsProps) {
  const rows = jobTimeForDate(stamps, workDate);

  if (rows.length === 0) {
    return (
      <p className="shd-none">
        No job time recorded against this shift — the jobs you tap Arrived and Done on show up here.
      </p>
    );
  }

  const totals = jobTimeTotals(rows);
  // A running shift has no final length, so the difference is not a fact yet.
  const gap = shiftRunning ? null : jobTimeGapNote(shiftHours, totals.attributed);

  return (
    <>
      <div className="shd-head">
        <span>Job</span>
        <span>Arrived</span>
        <span>Done</span>
        <span>Hours</span>
      </div>
      {rows.map((row) => (
        <JobRow key={row.key} row={row} />
      ))}
      <div className="shd-foot">
        <span className="shd-sum">
          {totals.attributed.toFixed(HOURS_PRECISION)} h on jobs
          {/* "never stamped" would be false for a visit he tapped Done on — it is a MISSING TAP,
              which is also the thing the office can fix. */}
          {totals.unmeasured > 0
            ? ` · ${totals.unmeasured} visit${totals.unmeasured === 1 ? "" : "s"} missing a tap`
            : ""}
        </span>
        {gap !== null ? <span className="shd-gap">{gap}</span> : null}
      </div>
    </>
  );
}
