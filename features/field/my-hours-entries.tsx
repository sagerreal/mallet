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
import { MyHoursTimeEditor } from "./my-hours-time-editor";

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
  readonly onSave: (entryId: string, startTime: string, endTime: string) => void;
}

interface RowProps extends Omit<MyHoursWeekProps, "entries" | "weekStartISO"> {
  readonly entry: MyHoursEntry;
}

function EntryRow(props: RowProps) {
  const { entry, today, myUserId, editingId, saving, saveError, suggestEndFor, onEdit, onSave } = props;
  const lock = editabilityOf(entry, today, myUserId);
  const editing = editingId === entry.id;
  const kind = KIND_LABELS[entry.kind];
  const suggested = entry.running ? suggestEndFor(entry) : null;

  return (
    <>
      <div className={`ts-e${entry.status === "approved" ? " appr" : ""}${editing ? " editing" : ""}`}>
        <span className={`ts-kind${entry.kind === "job" ? " job" : ""}`}>{kind}</span>
        <span className="ts-elabel">
          {kind}
          {entry.note ? <span className="muted"> · {entry.note}</span> : null}
        </span>
        <span className="ts-etime">
          {clockLabel(entry.startTime)}–{entry.endTime ? clockLabel(entry.endTime) : "still open"}
        </span>
        <span className="ts-ehrs">{entryHours(entry).toFixed(HOURS_PRECISION)} h</span>
        <span className="ts-eact mh-act">
          {lock.editable ? (
            <Button variant="quiet" size="sm" onClick={() => onEdit(editing ? null : entry.id)}>
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
          startTime={entry.startTime}
          endTime={entry.endTime ?? suggested ?? ""}
          suggestedEnd={suggested}
          saving={saving}
          serverError={saveError}
          onSave={(startTime, endTime) => onSave(entry.id, startTime, endTime)}
          onCancel={() => onEdit(null)}
        />
      ) : null}
    </>
  );
}

export function MyHoursWeek({ entries, weekStartISO, ...rest }: MyHoursWeekProps) {
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
            {rows.map((entry) => (
              <EntryRow key={entry.id} entry={entry} {...rest} />
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
