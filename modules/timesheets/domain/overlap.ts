import { toMinutes } from "./time-entry";

/**
 * One person cannot be two places at once.
 *
 * The day clock writes strictly sequential segments — a break is its own row BESIDE a worked
 * one, never inside it — so two rows for the same tech that share a moment are always an error,
 * and an unrefused overlap double-counts the day's total straight into payroll. This is the
 * manual-entry gate only: clock taps write through SetClockStateUseCase, never through here,
 * so the clock itself can never be refused.
 *
 * Intervals are half-open [start, end) in wall-clock minutes — a row that ends 10:00 and a row
 * that starts 10:00 touch, they don't overlap. A running row has no end yet; it is treated as
 * open-ended, because whenever the clock closes it, the closed segment will cover everything
 * after its start.
 */

/** The slice of a row the overlap rule reads — structural, so both domain entries and
 *  use-case commands fit without conversion. */
export interface OverlapWindow {
  readonly id: string;
  readonly kind: string;
  readonly startTime: string; // HH:MM
  readonly endTime: string | null; // HH:MM, or null while running
  readonly running: boolean;
}

export interface OverlapCandidate {
  readonly id?: string; // set on update — a row never clashes with itself
  readonly startTime: string;
  readonly endTime: string | null;
  readonly running: boolean;
}

const OPEN_ENDED = Number.POSITIVE_INFINITY;

const KIND_LABEL: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};

/** The refusal a use-case returns when findOverlap names a clash. Lives beside the rule so the
 *  create and update gates can never phrase the same collision two different ways. */
export function overlapRefusal(clash: OverlapWindow): string {
  if (clash.endTime === null) {
    return `Still on the clock since ${clash.startTime} — close the day before adding hours over it.`;
  }
  const kind = KIND_LABEL[clash.kind] ?? clash.kind;
  return `Overlaps ${kind} ${clash.startTime}–${clash.endTime} — adjust the times or edit that row.`;
}

/** [start, end) in minutes, end = ∞ while running; null when the times cannot parse — the entry
 *  factory refuses to create such a row, so guessing here would only invent clashes. */
const windowOf = (w: Pick<OverlapWindow, "startTime" | "endTime" | "running">): readonly [number, number] | null => {
  const start = toMinutes(w.startTime);
  if (start === null) return null;
  const end = w.running || w.endTime === null ? OPEN_ENDED : toMinutes(w.endTime);
  return end === null ? null : [start, end];
};

/**
 * The earliest-starting row the candidate collides with, or null. Earliest-starting (not
 * first-found) so the refusal names the same row every time.
 */
export function findOverlap(
  candidate: OverlapCandidate,
  existing: readonly OverlapWindow[],
): OverlapWindow | null {
  const cand = windowOf(candidate);
  if (cand === null) return null;

  let clash: { row: OverlapWindow; start: number } | null = null;
  for (const row of existing) {
    // candidate.id is undefined on create, and no row carries an undefined id.
    if (row.id === candidate.id) continue;
    const w = windowOf(row);
    if (w === null) continue;
    const collides = cand[0] < w[1] && w[0] < cand[1];
    if (collides && (clash === null || w[0] < clash.start)) clash = { row, start: w[0] };
  }
  return clash?.row ?? null;
}
