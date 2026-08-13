"use client";

/**
 * features/field/hours-summary.tsx
 * The three figures at the top of My hours: what he is owed, what of it is overtime, and whether
 * any of it is missing.
 *
 * WHY THESE THREE. A timesheet screen answers one question — "will my paycheck be right?" — and it
 * takes exactly three numbers to answer it: the hours, the premium portion, and whether anything is
 * absent. Anything else (job counts, averages, streaks) belongs to the office.
 *
 * EVERY FIGURE NAMES ITS RULE. The overtime cell states the threshold it used, because the rule
 * differs by state and a figure nobody can derive is a figure nobody trusts. The regular cell's bar
 * is measured against the shop's own weekly threshold for the same reason — never a compiled-in
 * forty (see features/settings/use-overtime-policy.tsx).
 *
 * THE MISSING CELL COUNTS THE CARDS BELOW IT. Its days come from the same array the page maps into
 * UnreportedDayCards, so the count and the callouts can never disagree — one definition of
 * "missing" on one screen. That definition is EVIDENCE-BASED (visits stamped, no hours), not
 * schedule-based: a shop that never filled in who works Saturdays gets no invented accusations.
 */

import { hmLabel } from "@/lib/time";
import { shortDayLabel } from "./my-hours-derive";

const PERCENT = 100;

export interface HoursSummaryProps {
  /** Paid hours that are not overtime — worked straight time plus paid time off. Uncapped. */
  readonly regularHours: number;
  readonly overtimeHours: number;
  /** The weekly threshold the bar is measured against, in hours. From the shop's own policy. */
  readonly weeklyThresholdHours: number;
  /** Names the rule the overtime figure was computed with, e.g. "past 8h a day or 40h this week". */
  readonly rulePhrase: string;
  /** ISO dates with evidence of work and no hours recorded. */
  readonly missingDays: readonly string[];
}

/** One cell. Kept local: three cells with one shape is the whole point of the strip. */
function Cell({
  label,
  value,
  unit,
  sub,
  bar,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  bar?: number;
}) {
  return (
    <div className="sum-cell">
      <div className="sum-lbl">{label}</div>
      <div className="sum-val">
        <span className="n">{value}</span>
        {unit ? <span className="u">{unit}</span> : null}
      </div>
      {bar === undefined ? null : (
        <div className="sum-bar">
          <i style={{ width: `${bar}%` }} />
        </div>
      )}
      <div className="sum-sub">{sub}</div>
    </div>
  );
}

export function HoursSummary({
  regularHours,
  overtimeHours,
  weeklyThresholdHours,
  rulePhrase,
  missingDays,
}: HoursSummaryProps) {
  // Capped at 100 so a 48-hour regular week (a full week plus a paid holiday) does not draw a bar
  // past its own track. The FIGURE stays uncapped — the bar is the only thing that has an end.
  const filled = Math.min(PERCENT, (regularHours / weeklyThresholdHours) * PERCENT);

  return (
    <div className="summary">
      <Cell
        label="Regular hours"
        value={hmLabel(regularHours)}
        sub={`of a ${weeklyThresholdHours}h week`}
        bar={filled}
      />
      <Cell label="Overtime" value={hmLabel(overtimeHours)} sub={rulePhrase} />
      <Cell
        label="Days missing hours"
        value={String(missingDays.length)}
        unit={missingDays.length === 1 ? "day" : "days"}
        sub={
          missingDays.length === 0
            ? "Every day you worked is reported."
            : `${missingDays.map(shortDayLabel).join(", ")} — add the hours or tell the office.`
        }
      />
    </div>
  );
}
