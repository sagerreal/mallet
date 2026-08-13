"use client";

/**
 * features/field/hours-sheet.tsx
 * The week as a REGISTER: one row per shift, with the clock's own columns — start, the break, end,
 * total. The shape a timesheet has had since timesheets were paper, because it is the shape that
 * lets a man scan a week and see the day that is wrong.
 *
 * ONE ROW PER SHIFT, NOT PER STORED ROW. The clock writes a row every time it is tapped, so a
 * single 7-to-4 day with a lunch is three stored entries. Showing three rows for one day asks the
 * technician to reassemble his own shift in his head; `shiftRows` (features/field/hours-sheet-derive.ts)
 * assembles it instead, spanning the break and splitting only where he genuinely went off the clock.
 *
 * THE MERGE NEVER PUTS A CORRECTION OUT OF REACH. That is the rule the office grid learned the hard
 * way: a merged row that cannot be edited is a wrong hour a man cannot fix. So —
 *
 *   one stored entry  → the pencil edits it in place, under the row.
 *   several           → the chevron opens the parts, each with its own pencil.
 *
 * A RUNNING SHIFT AND A SUBMITTED WEEK ARE BOTH UNTOUCHABLE, for opposite reasons: the running one
 * belongs to the clock (end the day, then correct it), the submitted one belongs to the office. Both
 * say so rather than presenting a control that does nothing.
 */

import { useState } from "react";
import { clockLabel, sheetDayLabel, HOURS_PRECISION, type MyHoursEntry } from "./my-hours-derive";
import { shiftRows, type ShiftRow } from "./hours-sheet-derive";
import { editabilityOf, dayLockNotes } from "./my-hours-edit";
import { EntryRow, type MyHoursWeekProps } from "./my-hours-entries";
import { MyHoursTimeEditor, type EntryKind } from "./my-hours-time-editor";
import { HoursJobRows } from "./hours-job-rows";
import type { VisitStamp } from "./job-time-derive";

type RowActions = Omit<MyHoursWeekProps, "entries" | "weekStartISO">;

/* The register's three glyphs, lifted from the mock. Inline and stroked with currentColor, the
   house idiom — `aria-hidden` because the button's own aria-label already says what it does, and a
   labelled icon inside a labelled button reads the action twice. */
const Pencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16.5 3.9a2 2 0 0 1 2.8 2.8L7.6 18.4l-4 1.2 1.2-4z" />
  </svg>
);

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

const Close = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** A clock column that holds nothing — present, and visibly empty. */
function Clock({ at }: { at: string | null }) {
  return <span className={`sh-cell${at === null ? " none" : ""}`}>{clockLabel(at)}</span>;
}

/** The six data columns: the day, the clock's four stamps, and the total. */
function ShiftCells({ row }: { row: ShiftRow }) {
  const firstBreak = row.breaks[0] ?? null;
  const extraBreaks = Math.max(0, row.breaks.length - 1);

  return (
    <>
      <span className="sh-cell day">{sheetDayLabel(row.workDate)}</span>
      <Clock at={row.startTime} />
      <Clock at={firstBreak?.startTime ?? null} />
      <span className={`sh-cell${firstBreak === null ? " none" : ""}`}>
        {clockLabel(firstBreak?.endTime ?? null)}
        {/* The register shows the first break and counts the rest — a second lunch is rare enough
            that a column each would cost every ordinary week its readability. */}
        {extraBreaks > 0 ? (
          <span className="sh-more">{`+${extraBreaks} more break${extraBreaks === 1 ? "" : "s"}`}</span>
        ) : null}
      </span>
      {row.running ? (
        <span className="sh-cell">
          <span className="sh-run">On the clock</span>
        </span>
      ) : (
        <Clock at={row.endTime} />
      )}
      <span className="sh-total">
        {row.hours.toFixed(HOURS_PRECISION)}
        {/* A running shift's total is what has been RECORDED, not how long he has been standing
            there: the open stretch has no end yet, so it counts nothing. Saying "h" flat would
            read as the shift's length and invite "why does it say 2 hours when I started at 7?" */}
        <span className="u">{row.running ? "h so far" : "h"}</span>
      </span>
    </>
  );
}

/** The row's controls: edit this shift (when the row can own the edit), and see what it is made of. */
function ShiftActions({
  day,
  editableId,
  editing,
  open,
  onEdit,
  onToggle,
}: {
  day: string;
  /** The entry the pencil would edit, or null when the row must not own the edit. */
  editableId: string | null;
  editing: boolean;
  open: boolean;
  onEdit: (entryId: string | null) => void;
  onToggle: () => void;
}) {
  return (
    <span className="sh-acts">
      {editableId !== null ? (
        <button
          type="button"
          className="sh-ico"
          aria-label={`${editing ? "Close" : "Edit"} the shift on ${day}`}
          aria-expanded={editing}
          onClick={() => onEdit(editing ? null : editableId)}
        >
          {editing ? <Close /> : <Pencil />}
        </button>
      ) : null}
      {/* Always available: seeing what a row is made of is not an edit. */}
      <button
        type="button"
        className={`sh-ico mut${open ? " open" : ""}`}
        aria-label={`${open ? "Hide" : "Show"} what the ${day} shift is made of`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Chevron />
      </button>
    </span>
  );
}

/**
 * The one stored entry this row may edit itself, or null.
 *
 * Null for a MERGED shift — the row will not guess which part he meant, and the chevron reaches all
 * of them — and null when any part is locked, because half an editable shift is a trap.
 */
function rowEditable(row: ShiftRow, today: string, myUserId: string | undefined): string | null {
  if (row.running || row.entries.length !== 1) return null;
  const [only] = row.entries;
  if (!only) return null;
  return editabilityOf(only, today, myUserId).editable ? only.id : null;
}

/**
 * Every distinct reason this shift is not editable, stated once. A running shift gets its own
 * sentence: it is not locked, it is simply not finished, and the fix is a tap he already knows.
 */
function lockNotesFor(row: ShiftRow, today: string, myUserId: string | undefined): string[] {
  if (row.running) return ["Still on the clock — end the day and this becomes correctable."];
  return dayLockNotes(row.entries, today, myUserId);
}

interface SheetRowProps extends RowActions {
  readonly row: ShiftRow;
  readonly open: boolean;
  readonly onToggle: () => void;
  /** The week's visit taps. Filtered per row by date — one read for the week, not one per row. */
  readonly stamps: readonly VisitStamp[];
}

function SheetRow({ row, open, onToggle, stamps, ...actions }: SheetRowProps) {
  const { today, myUserId, editingId, saving, saveError, suggestEndFor, onEdit, onSave, onDelete } = actions;
  const editableId = rowEditable(row, today, myUserId);
  const single = row.entries.length === 1 ? (row.entries[0] ?? null) : null;
  const editing = editableId !== null && editingId === editableId;
  const suggested = single?.running ? suggestEndFor(single) : null;
  const rowLocks = lockNotesFor(row, today, myUserId);

  return (
    <div className={`sh-entry${open || editing ? " open" : ""}`}>
      <div className="sh-row">
        <ShiftCells row={row} />
        <ShiftActions
          day={sheetDayLabel(row.workDate)}
          editableId={editableId}
          editing={editing}
          open={open}
          onEdit={onEdit}
          onToggle={onToggle}
        />
      </div>

      {/* WHY a row cannot be edited, on the row and never behind the chevron. A control that is
          absent without explanation is how a man learns to stop reporting mistakes — and the
          reason is the actionable part ("ask the office" vs "end the day first"). */}
      {rowLocks.map((note) => (
        <p className="mh-lock sh-lock" key={note}>
          {note}
        </p>
      ))}

      {editing && single ? (
        <div className="sh-detail">
          <MyHoursTimeEditor
            kind={single.kind as EntryKind}
            jobId={single.jobId ?? null}
            startTime={single.startTime ?? ""}
            endTime={single.endTime ?? suggested ?? ""}
            suggestedEnd={suggested}
            saving={saving}
            serverError={saveError}
            onSave={(patch) => onSave(single.id, patch)}
            onDelete={() => onDelete(single.id)}
            onCancel={() => onEdit(null)}
          />
        </div>
      ) : null}

      {open ? (
        <div className="sh-detail">
          {/* WHAT THE SHIFT WAS SPENT ON. Not a breakdown of it: job time does not sum to the shift
              and is not meant to (drive time is paid and belongs to no job), so this panel explains
              the difference in a sentence rather than balancing it into a row. */}
          <HoursJobRows
            stamps={stamps}
            workDate={row.workDate}
            shiftHours={row.hours}
            shiftRunning={row.running}
          />
          {/* THE PARTS, but only for a shift the row itself cannot edit. A merged shift's minutes
              have to stay reachable — that is the rule the office grid learned the hard way — while
              an ordinary one-entry day is edited by its own pencil and needs no second list. */}
          {editableId === null && row.entries.length > 1 ? (
            <div className="shd-parts">
              <p className="shd-partshead">This shift was recorded in {row.entries.length} pieces</p>
              {row.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} showKind={false} {...actions} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface HoursSheetProps extends RowActions {
  readonly entries: readonly MyHoursEntry[];
  /** The week's visit taps, for the attribution panel under each shift. */
  readonly stamps: readonly VisitStamp[];
}

export function HoursSheet({ entries, stamps, ...actions }: HoursSheetProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = shiftRows(entries);

  return (
    <div className="sheet">
      <div className="sh-head">
        <span>Date</span>
        <span>Start</span>
        <span>Break start</span>
        <span>Break end</span>
        <span>End</span>
        <span>Total</span>
        <span />
      </div>
      {rows.length === 0 ? (
        <div className="sh-empty">No shifts recorded this week.</div>
      ) : (
        rows.map((row) => (
          <SheetRow
            key={row.key}
            row={row}
            open={openKey === row.key}
            onToggle={() => setOpenKey((k) => (k === row.key ? null : row.key))}
            stamps={stamps}
            {...actions}
          />
        ))
      )}
    </div>
  );
}
