"use client";

/**
 * features/field/my-hours-still-open.tsx
 * The banner for a day the technician left running.
 *
 * It SUGGESTS an end time — the end of the last completed activity that day — and takes one tap
 * to accept. It never closes the day by itself, and there is no timer behind it: hours nobody
 * confirmed are exactly the record that loses a wage claim, and the week cannot be approved
 * while this row is open, so the omission stays loud instead of being quietly invented away.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { KIND_LABELS, clockLabel, dayLabel, type MyHoursEntry } from "./my-hours-derive";
import { timesProblem } from "./my-hours-edit";

export interface StillOpenBannerProps {
  readonly entry: MyHoursEntry;
  /** The end of the last completed activity that day, or null when the day holds nothing later. */
  readonly suggestedEnd: string | null;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onEnd: (endTime: string) => void;
}

export function StillOpenBanner({ entry, suggestedEnd, saving, error, onEnd }: StillOpenBannerProps) {
  const [chosen, setChosen] = useState(suggestedEnd ?? "");
  // Open by default when there is nothing to accept — otherwise the banner would state a problem
  // and offer no way to fix it.
  const [picking, setPicking] = useState(suggestedEnd === null);
  const problem = timesProblem(entry.startTime, chosen);

  return (
    <Card className="mh-open">
      <p className="mh-h">Your day is still open</p>
      <p className="mh-s">
        {KIND_LABELS[entry.kind]} started {clockLabel(entry.startTime)} on {dayLabel(entry.workDate)}{" "}
        and has no end time. These hours can&rsquo;t be approved until it&rsquo;s closed.
      </p>
      {suggestedEnd === null ? (
        <p className="mh-s">Nothing later that day to suggest an end from — set the time yourself.</p>
      ) : null}
      <div className="mh-acts">
        {suggestedEnd !== null ? (
          <Button disabled={saving} onClick={() => onEnd(suggestedEnd)}>
            {saving ? "Saving…" : `End at ${clockLabel(suggestedEnd)}`}
          </Button>
        ) : null}
        {suggestedEnd !== null && !picking ? (
          <Button variant="quiet" onClick={() => setPicking(true)}>
            Use a different time
          </Button>
        ) : null}
      </div>
      {picking ? (
        <div className="ts-editor">
          <Field label="End time">
            <input
              type="time"
              value={chosen}
              aria-label="End time"
              onChange={(e) => setChosen(e.target.value)}
            />
          </Field>
          {problem !== null ? <p className="mh-err">{problem}</p> : null}
          <div className="mh-acts">
            <Button disabled={problem !== null || saving} onClick={() => onEnd(chosen)}>
              {saving ? "Saving…" : "End my day"}
            </Button>
          </div>
        </div>
      ) : null}
      {error !== null ? <p className="mh-err">{error}</p> : null}
    </Card>
  );
}
