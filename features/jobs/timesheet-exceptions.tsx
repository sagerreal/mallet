"use client";

/**
 * features/jobs/timesheet-exceptions.tsx
 * What has to be fixed before this week is signed off.
 *
 * AN APPROVER IS SCANNING FOR PROBLEMS, so the problems come first and everything below the strip
 * is known-good. Before this, a week with a missing day looked exactly like a week without one:
 * the person simply had fewer rows, and nothing on the screen said the difference between "did not
 * work Wednesday" and "worked Wednesday and never sent it in".
 *
 * ONE KIND OF EXCEPTION, deliberately. A hole inside a day is usually correct — the technician got
 * off the clock — and a strip that cries about correct behaviour is a strip people learn to scroll
 * past. A day with visits stamped and no hours at all is unambiguous, and it is somebody's pay.
 */

import { Button } from "@/components/ui/button";
import { dayLabel } from "@/features/field/my-hours-derive";

export interface TimesheetException {
  readonly userId: string;
  readonly date: string;
  readonly visits: number;
}

export interface TimesheetExceptionsProps {
  readonly items: readonly TimesheetException[];
  /** Resolves a user id to a display name — the office knows the crew, this component does not. */
  readonly nameOf: (userId: string) => string;
  /** Opens that person's week at that day, so Add entry lands where the problem is. */
  readonly onReview: (userId: string, date: string) => void;
}

export function TimesheetExceptions({ items, nameOf, onReview }: TimesheetExceptionsProps) {
  if (items.length === 0) return null;

  return (
    <div className="ts-exc">
      <div className="ts-exc-h">
        <span>Fix before approving</span>
        <span className="ts-exc-n">
          {items.length} {items.length === 1 ? "day" : "days"}
        </span>
      </div>
      {items.map((x) => (
        <div className="ts-exc-row" key={`${x.userId}-${x.date}`}>
          <span>
            <b>{nameOf(x.userId)}</b> — {dayLabel(x.date)}: {x.visits}{" "}
            {x.visits === 1 ? "visit" : "visits"} stamped, no hours sent in
          </span>
          <Button variant="quiet" size="sm" onClick={() => onReview(x.userId, x.date)}>
            Review
          </Button>
        </div>
      ))}
    </div>
  );
}
