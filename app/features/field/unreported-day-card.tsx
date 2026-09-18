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
import { stampHHMM } from "./job-time-derive";

export interface UnreportedDayCardProps {
  readonly date: string;
  readonly visits: number;
  /** Earliest activity that day, as an ISO INSTANT — rendered and stored in the DEVICE's zone. */
  readonly firstStampAt: string | null;
  readonly lastStampAt: string | null;
  readonly busy: boolean;
  /** False when the shop keeps timesheet changes with the office — then this is a NOTICE, not an
   *  offer, because both buttons write hours the server would refuse. */
  readonly canRecord: boolean;
  /** Writes the suggested range as one worked entry. Only offered when both stamps exist. */
  readonly onAccept: (startTime: string, endTime: string) => void;
  /** Opens the ordinary add-hours form for this day, prefilled with nothing. */
  readonly onEnterOwn: (date: string) => void;
}

export function UnreportedDayCard({
  date,
  visits,
  firstStampAt,
  lastStampAt,
  busy,
  canRecord,
  onAccept,
  onEnterOwn,
}: UnreportedDayCardProps) {
  // Both ends, and in the right order. A single stamp cannot describe a shift, and a reversed pair
  // is a bad device clock — either way there is nothing honest to offer, so only the second button
  // shows and he types what he worked.
  const canSuggest = Boolean(firstStampAt && lastStampAt && firstStampAt < lastStampAt);
  /**
   * The wall clock HE was looking at. These arrive as instants because rendering them in SQL put
   * them in the database's timezone: this card offered a California technician "Add 4:05a–4:56a" for
   * a day he worked nine to five, and that button WRITES hours. A wrong label is confusing; a wrong
   * stored time is a wrong paycheck.
   */
  const first = canSuggest ? stampHHMM(firstStampAt!) : "";
  const last = canSuggest ? stampHHMM(lastStampAt!) : "";

  return (
    <div className="mh-unreported">
      <b>
        You worked {dayLabel(date)} and sent in no hours.
      </b>
      <span className="muted">
        {visits} {visits === 1 ? "visit is" : "visits are"} stamped to you that day
        {canSuggest ? ` · first ${clockLabel(first)}, last ${clockLabel(last)}` : ""}.
      </span>
      {canRecord ? (
      <div className="mh-unreported-acts">
        {canSuggest ? (
          <Button size="sm" disabled={busy} onClick={() => onAccept(first, last)}>
            {busy ? "Adding…" : `Add ${clockLabel(first)}–${clockLabel(last)}`}
          </Button>
        ) : null}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => onEnterOwn(date)}>
          Enter my own hours
        </Button>
      </div>
      ) : (
        <span className="muted">Ask the office to add this day.</span>
      )}
    </div>
  );
}
