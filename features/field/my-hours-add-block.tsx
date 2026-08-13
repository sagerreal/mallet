"use client";

/**
 * features/field/my-hours-add-block.tsx
 * "Add hours" — the technician's own repair for a block the clock missed, and since Aug 11
 * also the way planned time lands ahead (the day window runs a week each way)
 * (no signal in a crawlspace, a forgotten morning punch, a supply-house run).
 *
 * Expands in-flow beneath its trigger. Day and both times are pickers, not text boxes: the point
 * of the form is that a wrong value cannot be typed onto a payroll record in the first place.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, useGroupLabel } from "@/components/ui/input";
import { KIND_LABELS, dayLabel, type MyHoursEntry } from "./my-hours-derive";
import { editWindowDates, timesProblem } from "./my-hours-edit";
import type { AddBlockInput } from "./use-my-hours-writes";
import { SelectMenu } from "@/components/ui/select-menu";

// The add block types PUNCHED rows only — time off has its own entry path (a kind, a day and
// a length; no times), so the clock kinds are the whole menu here.
type Kind = "job" | "travel" | "break" | "shop";

const KINDS: readonly Kind[] = ["job", "travel", "shop", "break"];

/**
 * Unassigned shop time is the honest default: it is the state the day container itself runs in,
 * it is paid, and it claims nothing about a job the technician has not named.
 */
const DEFAULT_KIND: Kind = "shop";

function KindPicker({ value, onPick }: { value: Kind; onPick: (kind: Kind) => void }) {
  return (
    <div className="ts-seg">
      {KINDS.map((kind) => (
        <button
          key={kind}
          className={value === kind ? "on" : ""}
          aria-pressed={value === kind}
          onClick={() => onPick(kind)}
        >
          {KIND_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}

export interface AddBlockFormProps {
  readonly today: string;
  readonly techUserId: string | undefined;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onAdd: (input: AddBlockInput, onDone: () => void) => void;
  readonly onCancel: () => void;
}

export function AddBlockForm({ today, techUserId, saving, error, onAdd, onCancel }: AddBlockFormProps) {
  const [workDate, setWorkDate] = useState(today);
  const kindGroup = useGroupLabel();
  const [kind, setKind] = useState<Kind>(DEFAULT_KIND);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const problem = timesProblem(startTime, endTime);

  const submit = (): void => {
    if (techUserId === undefined || problem !== null) return;
    onAdd({ techUserId, workDate, kind, startTime, endTime, note: note.trim() }, () => {
      setStartTime("");
      setEndTime("");
      setNote("");
      onCancel();
    });
  };

  return (
    <div className="ts-editor">
      <Field label="Day">
        {/* No aria-label here or below: an aria-label outranks the <label> element,
            so it made each Field's visible label decorative and getByLabelText could
            not resolve these controls. The label is the name now. */}
        <SelectMenu
          value={workDate}
          onChange={setWorkDate}
          options={editWindowDates(today).map((date) => ({ value: date, label: dayLabel(date) }))}
          aria-label="Work date"
          compact
        />
      </Field>
      <div className="ts-erow" {...kindGroup.groupProps}>
        <label {...kindGroup.labelProps}>Type</label>
        <KindPicker value={kind} onPick={setKind} />
      </div>
      {kind === "job" ? (
        <p className="mh-s">Say which job in the note — the office attaches it to the job for you.</p>
      ) : null}
      <div className="ts-times">
        <div className="ts-timecol">
          <Field label="Start">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
        </div>
        <div className="ts-timecol">
          <Field label="End">
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Note (optional)">
        <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {problem !== null ? <p className="mh-err">{problem}</p> : null}
      {error !== null ? <p className="mh-err">{error}</p> : null}
      <div className="mh-acts">
        <Button disabled={problem !== null || saving || techUserId === undefined} onClick={submit}>
          {saving ? "Adding…" : "Add these hours"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
