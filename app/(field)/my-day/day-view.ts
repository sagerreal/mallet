/**
 * app/(field)/my-day/day-view.ts
 *
 * A PAGED-TO day's cards — pure, like visit-cards.ts, but a different question. Today's agenda
 * asks "what is my work" (any date, carried-over included). A paged day asks "what does THIS day
 * hold": only visits dated the viewed day, complete ones bucketed as finished no matter when the
 * stamp landed — the server's date filter already scoped the day, and a multi-visit job's OTHER
 * days' visits ride along in its DTO and must not become cards here.
 */

import { visitStep, type DayCard, type DayCardJob } from "./visit-cards";

export interface DayView {
  /** Stops on this day still open — on a past day, work that never got finished. */
  readonly open: readonly DayCard[];
  readonly finished: readonly DayCard[];
  /** The day's booked load: summed visit durations, for the summary card. */
  readonly scheduledMinutes: number;
  readonly jobCount: number;
}

interface DayViewVisit {
  readonly id: string;
  readonly status: string;
  readonly scheduledDate: string | null;
  readonly scheduledStart: string | null;
  readonly durationMinutes?: number | null;
  readonly enrouteAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export function deriveDayView(
  jobs: readonly (DayCardJob & { visits: readonly DayViewVisit[] })[],
  viewDate: string,
): DayView {
  const open: DayCard[] = [];
  const finished: DayCard[] = [];
  let scheduledMinutes = 0;
  const jobIds = new Set<string>();

  for (const j of jobs) {
    if (j.status === "canceled") continue;
    for (const v of j.visits) {
      if (v.status === "canceled" || v.scheduledDate !== viewDate) continue;
      jobIds.add(j.id);
      scheduledMinutes += v.durationMinutes ?? 0;
      const step = visitStep(v);
      const card: DayCard = {
        key: `${j.id}:${v.id}`,
        jobId: j.id,
        visitId: v.id,
        step,
        day: v.scheduledDate,
        start: v.scheduledStart,
        completedAt: v.completedAt,
        startedAt: v.startedAt,
      };
      (step === 3 ? finished : open).push(card);
    }
  }

  const at = (c: DayCard) => c.start ?? "00:00";
  const byStart = (a: DayCard, b: DayCard) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);
  return {
    open: [...open].sort(byStart),
    finished: [...finished].sort(byStart),
    scheduledMinutes,
    jobCount: jobIds.size,
  };
}

/** "7h 45m" — the summary card's figure grammar. */
export function minutesLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}
