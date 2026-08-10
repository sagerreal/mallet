"use client";

/**
 * features/field/my-hours-entries.tsx
 * The technician's week, grouped by day: one row per recorded block, each correctable row
 * expanding an editor in place.
 *
 * A locked row is never silently inert. Approved rows carry a mark, and every distinct reason a
 * day's rows are locked is stated once beneath that day — because "the button does nothing" is
 * how a worker learns to stop reporting mistakes.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  KIND_LABELS,
  clockLabel,
  dayLabel,
  entryHours,
  paidHours,
  byDay,
  weekDates,
  HOURS_PRECISION,
  type MyHoursEntry,
} from "./my-hours-derive";
import { dayLockNotes, editabilityOf } from "./my-hours-edit";
import { runsForDay, runLength, type HoursRun } from "./my-hours-runs";
import { MyHoursTimeEditor, type EntryKind } from "./my-hours-time-editor";

export interface MyHoursWeekProps {
  readonly entries: readonly MyHoursEntry[];
  readonly weekStartISO: string;
  readonly today: string;
  readonly myUserId: string | undefined;
  readonly editingId: string | null;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly suggestEndFor: (entry: MyHoursEntry) => string | null;
  readonly onEdit: (entryId: string | null) => void;
  readonly onSave: (entryId: string, patch: { kind: EntryKind; jobId: string | null; startTime: string; endTime: string }) => void;
}

interface RowProps extends Omit<MyHoursWeekProps, "entries" | "weekStartISO"> {
  readonly entry: MyHoursEntry;
}

function EntryRow(props: RowProps) {
  const { entry, today, myUserId, editingId, saving, saveError, suggestEndFor, onEdit, onSave } = props;
  const lock = editabilityOf(entry, today, myUserId);
  const editing = editingId === entry.id;
  // Inside an expanded run the kind is worth showing again: it is the only thing distinguishing
  // one part from the next, and by this point the man has already asked to see the parts.
  const kind = KIND_LABELS[entry.kind];
  const suggested = entry.running ? suggestEndFor(entry) : null;

  return (
    <>
      {/*
        The WHOLE ROW opens the editor, matching the office grid. On a phone especially, a small
        button is a poor target next to the row it sits in (Fitts's Law) — and the Edit button stays,
        so the affordance is still visible.

        House .rowopen pattern: the container carries the MOUSE handler and no role/tabIndex, while a
        focusable child button carries keyboard access. A clickable div wrapping buttons would be a
        nested-interactive a11y violation, and axe is an enforcing gate.
      */}
      <div
        className={`ts-e${entry.status === "approved" ? " appr" : ""}${editing ? " editing" : ""}${lock.editable ? " rowclick" : ""}`}
        onClick={lock.editable ? () => onEdit(editing ? null : entry.id) : undefined}
      >
        <span className={`ts-kind${entry.kind === "job" ? " job" : ""}`}>{kind}</span>
        {lock.editable ? (
          <button
            type="button"
            className="ts-elabel rowopen"
            aria-label={`${editing ? "Close" : "Edit"} ${kind} entry, ${clockLabel(entry.startTime)}`}
            aria-expanded={editing}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(editing ? null : entry.id);
            }}
          >
            {kind}
            {entry.note ? <span className="muted"> · {entry.note}</span> : null}
          </button>
        ) : (
          <span className="ts-elabel">
            {kind}
            {entry.note ? <span className="muted"> · {entry.note}</span> : null}
          </span>
        )}
        <span className="ts-etime">
          {clockLabel(entry.startTime)}–{entry.endTime ? clockLabel(entry.endTime) : "still open"}
        </span>
        <span className="ts-ehrs">{entryHours(entry).toFixed(HOURS_PRECISION)} h</span>
        <span className="ts-eact mh-act">
          {lock.editable ? (
            <Button
              variant="quiet"
              size="sm"
              // The row opens the editor too, so this must not toggle it a second time.
              onClick={(e) => {
                e.stopPropagation();
                onEdit(editing ? null : entry.id);
              }}
            >
              {editing ? "Close" : "Edit"}
            </Button>
          ) : entry.status === "approved" ? (
            // The reason is stated once per day below; this marks WHICH rows it covers on a day
            // that is only partly signed off.
            <span className="mh-appr">
              ✓<span className="sr-only"> Approved</span>
            </span>
          ) : null}
        </span>
      </div>
      {editing ? (
        <MyHoursTimeEditor
          kind={entry.kind as EntryKind}
          jobId={entry.jobId ?? null}
          startTime={entry.startTime}
          endTime={entry.endTime ?? suggested ?? ""}
          suggestedEnd={suggested}
          saving={saving}
          serverError={saveError}
          onSave={(patch) => onSave(entry.id, patch)}
          onCancel={() => onEdit(null)}
        />
      ) : null}
    </>
  );
}

/**
 * One stretch of the day — "Worked 10:46a–1:51p", whatever chain of taps recorded it.
 *
 * A run of ONE renders the entry directly, so the ordinary day is untouched. A run of several
 * shows the stretch and opens to its parts, because the merge must never put a correction further
 * out of reach than it was: the man is responsible for his own hours, so every minute has to stay
 * editable.
 */
function RunRow({ run, expanded, onToggle, ...rest }: {
  run: HoursRun;
  expanded: boolean;
  onToggle: () => void;
} & Omit<MyHoursWeekProps, "entries" | "weekStartISO">) {
  const single = run.entries[0];
  if (run.entries.length === 1 && single) return <EntryRow entry={single} {...rest} />;

  const shown = run.paid ? run.hours : runLength(run);
  const span = `${clockLabel(run.startTime)}–${run.endTime ? clockLabel(run.endTime) : "still open"}`;

  return (
    <>
      <div className={`ts-e${expanded ? " editing" : ""} rowclick`} onClick={onToggle}>
        <span className="ts-kind">{run.label}</span>
        <button
          type="button"
          className="ts-elabel rowopen"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} the ${run.entries.length} entries behind ${run.label} ${span}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          {/* The pill already says Worked/Break; repeating it here read as "Worked Worked". What
              this adds is the fact the row is a merge, and how much is folded into it. */}
          <span className="muted">{run.entries.length} entries</span>
        </button>
        <span className="ts-etime">{span}</span>
        <span className="ts-ehrs">{shown.toFixed(HOURS_PRECISION)} h</span>
        <span className="ts-eact mh-act" />
      </div>
      {expanded ? run.entries.map((entry) => <EntryRow key={entry.id} entry={entry} {...rest} />) : null}
    </>
  );
}

export function MyHoursWeek({ entries, weekStartISO, ...rest }: MyHoursWeekProps) {
  const [openRun, setOpenRun] = useState<string | null>(null);

  if (entries.length === 0) {
    return <div className="empty-att">No hours recorded this week.</div>;
  }
  const grouped = byDay(entries);
  const days = weekDates(weekStartISO).filter((d) => grouped.has(d));

  return (
    <>
      {days.map((date) => {
        const rows = grouped.get(date) ?? [];
        const paid = rows.reduce((sum, e) => sum + paidHours(e), 0);
        return (
          <div className="ts-day" key={date}>
            <div className="ts-dhdr">
              <span>{dayLabel(date)}</span>
              <span className="num">{paid.toFixed(HOURS_PRECISION)} h</span>
            </div>
            {runsForDay(rows).map((run) => (
              <RunRow
                key={run.key}
                run={run}
                expanded={openRun === run.key}
                onToggle={() => setOpenRun((open) => (open === run.key ? null : run.key))}
                {...rest}
              />
            ))}
            {dayLockNotes(rows, rest.today, rest.myUserId).map((note) => (
              <p className="mh-lock" key={note}>
                {note}
              </p>
            ))}
          </div>
        );
      })}
    </>
  );
}
