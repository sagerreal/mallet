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

/**
 * `daily` shows the seven days; `summary` trades them for Regular / Overtime.
 *
 * Two readings of one week. Daily is for finding the day that looks wrong; summary is the shape
 * payroll is keyed from, and putting them behind a toggle beats making somebody do the subtraction.
 */
export type TsGridMode = "daily" | "summary";

export interface TimesheetsGridProps {
  readonly rows: readonly TsCrewRow[];
  readonly weekDates: string[];
  readonly mode: TsGridMode;
  /** The one open row, or null. One at a time: the grid's value is comparing people. */
  readonly openTechId: string | null;
  readonly onToggle: (techId: string) => void;
  /** Tech ids ticked for a batch action. Empty means the checkbox column is idle, not hidden. */
  readonly selected: ReadonlySet<string>;
  readonly onSelect: (techId: string, checked: boolean) => void;
  /** The expanded body — the panel supplies the entry rows and their editing. */
  readonly renderDetail: (techId: string) => ReactNode;
}

interface TsGridRowProps {
  readonly row: TsCrewRow;
  readonly weekDates: string[];
  readonly mode: TsGridMode;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly checked: boolean;
  readonly onSelect: (checked: boolean) => void;
}

function TsGridRow({ row, weekDates, mode, open, onToggle, checked, onSelect }: TsGridRowProps) {
  const empty = row.status === "empty";
  const approved = row.status === "approved";
  return (
    <div className={open ? "tsg-row tsg-open" : "tsg-row"}>
      {/* The tick sits OUTSIDE the row button. A checkbox nested in a button is not operable by
          keyboard and toggling it would also open the row — two actions on one press. An approved
          week has nothing left to approve, so its box is disabled rather than silently ignored. */}
      <label className="tsg-tickcell">
        <input
          type="checkbox"
          checked={checked}
          disabled={approved || empty}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`Select ${row.name}`}
        />
      </label>

      <button
        type="button"
        className="tsg-rowbtn"
        aria-expanded={open}
        onClick={onToggle}
      >
      <span className="tsg-who">
        <span className="tsg-avatar" aria-hidden="true">{row.initials}</span>
        <span className="tsg-name">{row.name}</span>
      </span>

      {mode === "daily" ? (
        row.dayHours.map((h, i) => (
          <span
            key={weekDates[i] ?? i}
            className={
              h === null ? "tsg-cell tsg-none" : row.otDays.has(i) ? "tsg-cell tsg-otday" : "tsg-cell"
            }
          >
            {h === null ? "—" : h.toFixed(1)}
          </span>
        ))
      ) : (
        <>
          {/* Regular is the uncapped remainder — what is actually being paid at the base rate,
              never "capped at the threshold", which states a smaller number than the cheque. */}
          <span className="tsg-sum">{(row.paid - row.ot).toFixed(2)}</span>
          <span className={row.ot > 0 ? "tsg-sum tsg-hasot" : "tsg-sum"}>{row.ot.toFixed(2)}</span>
        </>
      )}

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
    </div>
  );
}

export function TimesheetsGrid({
  rows,
  weekDates,
  mode,
  openTechId,
  onToggle,
  selected,
  onSelect,
  renderDetail,
}: TimesheetsGridProps) {
  if (rows.length === 0) {
    return <div className="empty-att">No crew match that filter.</div>;
  }

  return (
    <div className={mode === "summary" ? "tsg tsg-sum-mode" : "tsg"}>
      <div className="tsg-row tsg-head" aria-hidden="true">
        <span className="tsg-tickcell" />
        <span className="tsg-rowbtn">
          <span className="tsg-who">Technician</span>
          {mode === "daily" ? (
            DAY_HEADS.map((d, i) => (
              <span key={weekDates[i] ?? i} className="tsg-cell" title={tsDayShort(weekDates[i] ?? "")}>
                {d}
              </span>
            ))
          ) : (
            <>
              <span className="tsg-sum">Regular</span>
              <span className="tsg-sum">Overtime</span>
            </>
          )}
          <span className="tsg-total">Total</span>
          <span className="tsg-issues">Issues</span>
          <span className="tsg-statuscell">Status</span>
          <span className="tsg-chev" />
        </span>
      </div>

      {rows.map((row) => (
        <div key={row.techId}>
          <TsGridRow
            row={row}
            weekDates={weekDates}
            mode={mode}
            open={openTechId === row.techId}
            onToggle={() => onToggle(row.techId)}
            checked={selected.has(row.techId)}
            onSelect={(checked) => onSelect(row.techId, checked)}
          />
          {openTechId === row.techId && <div className="tsg-detail">{renderDetail(row.techId)}</div>}
        </div>
      ))}
    </div>
  );
}
