"use client";

/**
 * features/field/hours-week-nav.tsx
 * The week pager. Same grammar as the My day date pager — ‹ ›, a word for where you are, and one
 * button back to now — because they sit two taps apart in the same shell and a man should not have
 * to learn two ways to move through time.
 *
 * THE WORD, THEN THE DATES. "Last week" is what he thinks; "Aug 4 – Aug 10" is what he needs to be
 * sure. Showing only the range makes him count backwards to know where he is; showing only the word
 * fails the moment he is three weeks back.
 *
 * "Back to this week" appears only when he is away from it, and it is a distinct control from the
 * arrows: after four taps back, four taps forward is a chore, and it is also how a man loses his
 * place.
 */

import { addDaysISO } from "@/lib/clock";
import { Button } from "@/components/ui/button";
import { shortDayLabel, DAYS_PER_WEEK } from "./my-hours-derive";

/** How far `weekStartISO` is from this week, in whole weeks. Negative is the past. */
function weeksFromNow(weekStartISO: string, thisWeekISO: string): number {
  const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((day(weekStartISO) - day(thisWeekISO)) / (MS_PER_DAY * DAYS_PER_WEEK));
}

/**
 * The relative word. Only the three weeks either side of now get one: "5 weeks ago" is not a word a
 * man reads faster than the dates underneath it, so past that the range speaks for itself.
 */
export function weekWord(weekStartISO: string, thisWeekISO: string): string {
  const weeks = weeksFromNow(weekStartISO, thisWeekISO);
  if (weeks === 0) return "This week";
  if (weeks === -1) return "Last week";
  if (weeks === 1) return "Next week";
  if (weeks < 0) return `${-weeks} weeks ago`;
  return `In ${weeks} weeks`;
}

/** "Aug 4 – Aug 10" — the seven days the sheet below is showing, spelled out. */
export function weekRange(weekStartISO: string): string {
  return `${shortDayLabel(weekStartISO)} – ${shortDayLabel(addDaysISO(weekStartISO, DAYS_PER_WEEK - 1))}`;
}

export interface HoursWeekNavProps {
  readonly weekStartISO: string;
  readonly thisWeekISO: string;
  readonly onNav: (weeks: number) => void;
  readonly onThisWeek: () => void;
  /** The week's own controls (add, submit) — supplied by the page so this stays a pager. */
  readonly actions?: React.ReactNode;
  /** The oldest and newest week the page holds data for. Both Mondays; see myHoursWeekBounds. */
  readonly firstWeekISO: string;
  readonly lastWeekISO: string;
}

export function HoursWeekNav({
  weekStartISO,
  thisWeekISO,
  onNav,
  onThisWeek,
  actions,
  firstWeekISO,
  lastWeekISO,
}: HoursWeekNavProps) {
  const away = weekStartISO !== thisWeekISO;
  // Refused AT THE EDGE rather than silently clamped: an arrow that keeps its look and does nothing
  // reads as the app having stopped responding. Disabled, it says the history ends here.
  const canBack = weekStartISO > firstWeekISO;
  const canFwd = weekStartISO < lastWeekISO;

  return (
    <div className="weeknav">
      <button
        type="button"
        className="wk-ic"
        onClick={() => onNav(-1)}
        disabled={!canBack}
        aria-label="Previous week"
      >
        ‹
      </button>
      {/* The heading, and the only h2 on the page: it names what the sheet below is showing, so a
          screen reader arriving at the register knows which week it landed in. */}
      <h2 className="wk-label">
        <span className="wk-word">{weekWord(weekStartISO, thisWeekISO)}</span>
        <span className="wk-range">{weekRange(weekStartISO)}</span>
      </h2>
      <button
        type="button"
        className="wk-ic"
        onClick={() => onNav(1)}
        disabled={!canFwd}
        aria-label="Next week"
      >
        ›
      </button>
      {away ? (
        <Button variant="quiet" size="sm" onClick={onThisWeek}>
          Back to this week
        </Button>
      ) : null}
      <span className="wk-spacer" />
      {actions}
    </div>
  );
}
