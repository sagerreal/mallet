"use client";

/**
 * features/field/my-hours-time-editor.tsx
 * The in-flow start/end editor that expands beneath a timesheet row (no popover, no modal —
 * the row stays where it was and the editor opens under it).
 *
 * Both controls are native time pickers rather than text boxes on purpose: a free-text field
 * lets a technician type "8" or "0800" or "8pm" on a payroll record, and the first person to
 * discover the typo is the person paying him.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { timesProblem } from "./my-hours-edit";
import { clockLabel } from "./my-hours-derive";

export interface MyHoursTimeEditorProps {
  readonly startTime: string;
  /** Empty for a row left open. Pre-filled with the suggestion when there is one. */
  readonly endTime: string;
  /** Shown as a one-tap fill when the row is still open and the day has something to suggest. */
  readonly suggestedEnd?: string | null;
  readonly saving: boolean;
  /** The server's refusal, verbatim — it names the actual problem (e.g. an approved row). */
  readonly serverError: string | null;
  readonly onSave: (startTime: string, endTime: string) => void;
  readonly onCancel: () => void;
}

export function MyHoursTimeEditor({
  startTime: initialStart,
  endTime: initialEnd,
  suggestedEnd = null,
  saving,
  serverError,
  onSave,
  onCancel,
}: MyHoursTimeEditorProps) {
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const problem = timesProblem(startTime, endTime);

  return (
    <div className="ts-editor">
      <div className="ts-times">
        <div className="ts-timecol">
          <Field label="Start">
            <input
              type="time"
              value={startTime}
              aria-label="Start time"
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
        </div>
        <div className="ts-timecol">
          <Field label="End">
            <input
              type="time"
              value={endTime}
              aria-label="End time"
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {suggestedEnd !== null && endTime !== suggestedEnd ? (
        <Button variant="quiet" size="sm" onClick={() => setEndTime(suggestedEnd)}>
          Use {clockLabel(suggestedEnd)}
        </Button>
      ) : null}
      {problem !== null ? <p className="mh-err">{problem}</p> : null}
      {serverError !== null ? <p className="mh-err">{serverError}</p> : null}
      <div className="mh-acts">
        <Button
          size="sm"
          disabled={problem !== null || saving}
          onClick={() => onSave(startTime, endTime)}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
