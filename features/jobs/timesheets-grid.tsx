"use client";

/**
 * features/jobs/timesheets-grid.tsx
 * The office crew grid — every technician's week on one screen.
 *
 * WHAT THIS REPLACED, AND WHY. The office read one technician at a time behind a row of chips. On
 * payroll day the question is "who still needs me", and the chips could not answer it: they carried
 * hours but not status, not issues, not overtime. An approver clicked all eight and remembered.
 * Here the four facts that decide whether a week can be approved sit in four columns, and opening a
 * row gives the same entry rows the old card did — the detail did not change, the way in did.
 *
 * PRESENTATIONAL. Every figure arrives already derived (timesheet-grid-derive); the expanded body
 * is a render prop, so all the edit/approve plumbing stays in the panel that owns the store.
 *
 * CLASS NAMES ARE PREFIXED `tsg-` ON PURPOSE. prototype.css defines bare `.r`, `.l`, `.b`, `.n`,
 * `.m`, `.av`, `.who`, `.ot` and `.sub` as global utilities; a modifier sharing one of those names
 * silently inherits whatever it sets.
 */

import type { ReactNode } from "react";
import type { TsCrewRow, TsRowStatus } from "./timesheet-grid-derive";
import { tsDayShort } from "./timesheet-derive";

/** Monday-first initials for the column heads. Two Ts and two Ss is what a week looks like. */
const DAY_HEADS = ["M", "T", "W", "T", "F", "S", "S"] as const;

const STATUS_LABEL: Record<TsRowStatus, string> = {
  review: "Needs review",
  submitted: "Submitted",
  approved: "Approved",
  empty: "Nothing yet",
};

export interface TimesheetsGridProps {
  readonly rows: readonly TsCrewRow[];
  readonly weekDates: string[];
  /** The one open row, or null. One at a time: the grid's value is comparing people. */
  readonly openTechId: string | null;
  readonly onToggle: (techId: string) => void;
  /** The expanded body — the panel supplies the entry rows and their editing. */
  readonly renderDetail: (techId: string) => ReactNode;
}

interface TsGridRowProps {
  readonly row: TsCrewRow;
  readonly weekDates: string[];
  readonly open: boolean;
  readonly onToggle: () => void;
}

function TsGridRow({ row, weekDates, open, onToggle }: TsGridRowProps) {
  const empty = row.status === "empty";
  return (
    <button
      type="button"
      className={open ? "tsg-row tsg-open" : "tsg-row"}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="tsg-who">
        <span className="tsg-avatar" aria-hidden="true">{row.initials}</span>
        <span className="tsg-name">{row.name}</span>
      </span>

      {row.dayHours.map((h, i) => (
        <span
          key={weekDates[i] ?? i}
          className={
            h === null ? "tsg-cell tsg-none" : row.otDays.has(i) ? "tsg-cell tsg-otday" : "tsg-cell"
          }
        >
          {h === null ? "—" : h.toFixed(1)}
        </span>
      ))}

      {/* A week with nothing in it says so in the Status column; a 0.00 total there would read as
          "worked a zero-hour week", which is a different and untrue claim. */}
      <span className={empty ? "tsg-total tsg-muted" : "tsg-total"}>
        {row.paid.toFixed(2)}
        {row.ot > 0 && <small>{row.ot.toFixed(1)} OT</small>}
      </span>

      {/* Not a button inside a button — the whole row opens, and the issue count is the reason to
          open it. Rendering it as its own control would nest interactive elements. */}
      <span className={row.issues > 0 ? "tsg-issues tsg-has" : "tsg-issues"}>
        {row.issues > 0 ? `⚠ ${row.issues}` : "—"}
      </span>

      <span className="tsg-statuscell">
        <span className={`tsg-pill tsg-${row.status}`}>{STATUS_LABEL[row.status]}</span>
      </span>

      <span className="tsg-chev" aria-hidden="true">{open ? "⌄" : "›"}</span>
    </button>
  );
}

export function TimesheetsGrid({ rows, weekDates, openTechId, onToggle, renderDetail }: TimesheetsGridProps) {
  if (rows.length === 0) {
    return <div className="empty-att">No crew match that filter.</div>;
  }

  return (
    <div className="tsg">
      <div className="tsg-row tsg-head" aria-hidden="true">
        <span className="tsg-who">Technician</span>
        {DAY_HEADS.map((d, i) => (
          <span key={weekDates[i] ?? i} className="tsg-cell" title={tsDayShort(weekDates[i] ?? "")}>
            {d}
          </span>
        ))}
        <span className="tsg-total">Total</span>
        <span className="tsg-issues">Issues</span>
        <span className="tsg-statuscell">Status</span>
        <span className="tsg-chev" />
      </div>

      {rows.map((row) => (
        <div key={row.techId}>
          <TsGridRow
            row={row}
            weekDates={weekDates}
            open={openTechId === row.techId}
            onToggle={() => onToggle(row.techId)}
          />
          {openTechId === row.techId && <div className="tsg-detail">{renderDetail(row.techId)}</div>}
        </div>
      ))}
    </div>
  );
}
