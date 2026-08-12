"use client";

/**
 * app/(field)/my-day/day-pager.tsx — ‹ Today · Wed, Aug 12 › with Back to today.
 *
 * ±14 days, matching the server's own reach on v1.field.day (which allows one extra day of
 * timezone slack). The arrows disable at the bounds rather than wrapping — a route has edges.
 */

export const DAY_PAGER_REACH = 14;

/** ["Today", "Wed, Aug 12"] — the word and the date, both always shown. */
export function dayWords(iso: string, offset: number): [string, string] {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y as number, (m as number) - 1, d as number);
  const long = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const word =
    offset === 0 ? "Today"
    : offset === -1 ? "Yesterday"
    : offset === 1 ? "Tomorrow"
    : date.toLocaleDateString("en-US", { weekday: "long" });
  return [word, long];
}

export interface DayPagerProps {
  dateISO: string;
  offset: number;
  onStep: (delta: 1 | -1) => void;
  onToday: () => void;
}

export function DayPager({ dateISO, offset, onStep, onToday }: DayPagerProps) {
  const [word, long] = dayWords(dateISO, offset);
  return (
    <div className="mdp">
      <button
        type="button"
        className="md-ic"
        aria-label="Previous day"
        disabled={offset <= -DAY_PAGER_REACH}
        onClick={() => onStep(-1)}
      >
        ‹
      </button>
      <h2 className="mdp-label">
        {word} <span className="mdp-date">{long}</span>
      </h2>
      <button
        type="button"
        className="md-ic"
        aria-label="Next day"
        disabled={offset >= DAY_PAGER_REACH}
        onClick={() => onStep(1)}
      >
        ›
      </button>
      {offset !== 0 ? (
        <button type="button" className="btn sm ghost" onClick={onToday}>
          Back to today
        </button>
      ) : null}
    </div>
  );
}
