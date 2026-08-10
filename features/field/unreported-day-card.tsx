"use client";

/**
 * features/field/unreported-day-card.tsx
 * "You worked Wednesday and sent in no hours."
 *
 * THE ONLY GAP WORTH INTERRUPTING SOMEBODY ABOUT. A hole inside a day is usually correct — he got
 * off the clock — and flagging correct behaviour teaches people to ignore the flag. A day with
 * visits stamped on it and no hours at all is different: he was on jobs and his paycheck is short.
 *
 * The range is OFFERED, never written. It comes from his own first and last stamp, it is stated in
 * full before he taps, and the second button exists so that "those weren't my hours" is one tap
 * rather than an argument with the office. A timesheet has to stay his statement of what he did.
 */

import { Button } from "@/components/ui/button";
import { clockLabel, dayLabel } from "./my-hours-derive";

export interface UnreportedDayCardProps {
  readonly date: string;
  readonly visits: number;
  readonly firstAt: string | null;
  readonly lastAt: string | null;
  readonly busy: boolean;
  /** Writes the suggested range as one worked entry. Only offered when both stamps exist. */
  readonly onAccept: (startTime: string, endTime: string) => void;
  /** Opens the ordinary add-hours form for this day, prefilled with nothing. */
  readonly onEnterOwn: (date: string) => void;
}

export function UnreportedDayCard({
  date,
  visits,
  firstAt,
  lastAt,
  busy,
  onAccept,
  onEnterOwn,
}: UnreportedDayCardProps) {
  // Both ends, and in the right order. A single stamp cannot describe a shift, and a reversed pair
  // is a bad device clock — either way there is nothing honest to offer, so only the second button
  // shows and he types what he worked.
  const canSuggest = Boolean(firstAt && lastAt && firstAt < lastAt);

  return (
    <div className="mh-unreported">
      <b>
        You worked {dayLabel(date)} and sent in no hours.
      </b>
      <span className="muted">
        {visits} {visits === 1 ? "visit is" : "visits are"} stamped to you that day
        {canSuggest ? ` · first ${clockLabel(firstAt!)}, last ${clockLabel(lastAt!)}` : ""}.
      </span>
      <div className="mh-unreported-acts">
        {canSuggest ? (
          <Button size="sm" disabled={busy} onClick={() => onAccept(firstAt!, lastAt!)}>
            {busy ? "Adding…" : `Add ${clockLabel(firstAt!)}–${clockLabel(lastAt!)}`}
          </Button>
        ) : null}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => onEnterOwn(date)}>
          Enter my own hours
        </Button>
      </div>
    </div>
  );
}
