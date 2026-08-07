/**
 * modules/jobs/domain/labor-rollup.ts
 * Turning visit stamps into a job's labour — pure, so the rule can be argued with in a test
 * rather than inside a SQL string.
 *
 * WHERE THE HOURS COME FROM, and why it is not the clock. A visit records `started_at` when the
 * technician taps Arrived and `completed_at` when he taps Done. Those two taps already exist and
 * he already makes them, because the customer wants to know the plumber is here — so job time
 * costs him nothing extra. A second job clock would be a second punch for the same moment, and
 * the second punch is the one people forget.
 *
 * PROVENANCE TRAVELS WITH THE NUMBER. A figure derived from real taps and a figure guessed from
 * the schedule are not the same claim, and a costing report that presents them identically is
 * lying by omission — the shop cannot tell which jobs it actually measured. Every row says which
 * it is, and a row nobody measured or scheduled contributes nothing rather than zero.
 */

/** One visit, as the rollup needs to see it. */
export interface LaborVisit {
  readonly jobId: string;
  /** Arrived. Null when nobody tapped. */
  readonly startedAt: Date | null;
  /** Done. Null while the visit is still running, or when nobody tapped. */
  readonly completedAt: Date | null;
  /** The booked length, minutes. The fallback when there are no stamps. */
  readonly durationMinutes: number | null;
  /** Whether the visit finished — a booked length only stands in for a visit that actually ran. */
  readonly complete: boolean;
  /** Burdened cost of this visit's assignee, cents per hour. Null = the shop never told us. */
  readonly costRateCents: number | null;
}

/** How a visit's hours were arrived at. */
export type LaborSource = "measured" | "scheduled";

export interface VisitLabor {
  readonly hours: number;
  readonly source: LaborSource;
  /** Null when the assignee has no cost rate — hours without money, never hours at $0. */
  readonly costCents: number | null;
}

const MS_PER_HOUR = 3_600_000;
const MINUTES_PER_HOUR = 60;

/** Two decimal places — the precision a timesheet is read at, and enough to keep sums stable. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * One visit's labour, or null when there is nothing honest to say about it.
 *
 * Null covers the visit still in progress (arrived, not done — its hours are not final and a
 * running figure in a costing report would change every time the page is opened) and the visit
 * that was never measured and never booked a length.
 *
 * A NEGATIVE or zero span returns null rather than a negative cost. Clocks move backwards — a
 * device with a bad time, an office correction that crossed the stamps — and one such row would
 * silently subtract from a job's cost and report margin the shop never earned.
 */
export function visitLabor(v: LaborVisit): VisitLabor | null {
  const measured =
    v.startedAt && v.completedAt ? (v.completedAt.getTime() - v.startedAt.getTime()) / MS_PER_HOUR : null;

  if (measured !== null && measured > 0) return withCost(round2(measured), "measured", v.costRateCents);

  // No usable stamps. A booked length stands in ONLY for a visit that actually finished: on an
  // unfinished visit it would be a forecast presented as a cost.
  if (v.complete && v.durationMinutes && v.durationMinutes > 0) {
    return withCost(round2(v.durationMinutes / MINUTES_PER_HOUR), "scheduled", v.costRateCents);
  }
  return null;
}

const withCost = (hours: number, source: LaborSource, rateCents: number | null): VisitLabor => ({
  hours,
  source,
  costCents: rateCents === null ? null : Math.round(hours * rateCents),
});

export interface JobLabor {
  readonly jobId: string;
  /** Visits that contributed hours — NOT every visit on the job. */
  readonly visits: number;
  readonly hours: number;
  /**
   * Null when NO contributing visit had a cost rate. A partial figure is still returned when only
   * some did, with `costIsPartial` set — a shop half-way through filling in its rates should see
   * the half it has, told plainly that it is a half.
   */
  readonly costCents: number | null;
  readonly costIsPartial: boolean;
  /** "measured" only when every contributing visit was measured. */
  readonly source: LaborSource | "mixed";
}

/** Roll visits up per job. Jobs whose visits all contribute nothing are omitted entirely. */
export function rollUpLabor(visits: readonly LaborVisit[]): JobLabor[] {
  const byJob = new Map<string, VisitLabor[]>();

  for (const v of visits) {
    const labor = visitLabor(v);
    if (!labor) continue;
    const bucket = byJob.get(v.jobId);
    if (bucket) bucket.push(labor);
    else byJob.set(v.jobId, [labor]);
  }

  return [...byJob.entries()].map(([jobId, items]) => {
    const priced = items.filter((i) => i.costCents !== null);
    const sources = new Set(items.map((i) => i.source));
    return {
      jobId,
      visits: items.length,
      hours: round2(items.reduce((sum, i) => sum + i.hours, 0)),
      costCents: priced.length === 0 ? null : priced.reduce((sum, i) => sum + (i.costCents ?? 0), 0),
      costIsPartial: priced.length > 0 && priced.length < items.length,
      source: sources.size === 1 ? [...sources][0]! : "mixed",
    };
  });
}
