import type { Job } from "../domain/job";

/**
 * The order a day is actually worked.
 *
 * My day used to sort on `jobs.scheduled_start`, which is a DEAD COLUMN — nothing in a live path
 * writes it (see infra/job-sorts.ts: zero non-null rows across the pilot org). So the comparator
 * collapsed to "equal" for every pair and the agenda came back in whatever order the keyset
 * happened to produce: random v4 UUIDs. A route in arbitrary order is not a route, and it only got
 * more visible once finished jobs started staying on the list.
 *
 * The real date lives on the VISITS, which is where scheduling has always written it. The key is
 * the earliest LIVE visit's date and start time.
 *
 * STRING COMPARISON, DELIBERATELY. `scheduled_date` is a calendar date and `scheduled_start` is a
 * wall-clock time — neither carries a zone, and both are meant as "what the crew reads on the
 * board". Parsing them into Date on the server would stamp them with the SERVER'S timezone
 * (UTC in production) and reorder a day around a zone nobody involved lives in. Zero-padded
 * `YYYY-MM-DDTHH:MM` sorts correctly as text, so the comparison stays in the same terms the
 * board uses.
 */

/** Zero-padded, lexicographically sortable. Null when the job has no dated visit worth keying on. */
export function earliestLiveVisitAt(job: Job): string | null {
  let earliestLive: string | null = null;
  let earliestDone: string | null = null;
  let unplacedLive = false;
  for (const visit of job.props.visits) {
    const v = visit.props;
    // Canceled visits are not work.
    if (v.status === "canceled") continue;
    // A live visit with no date is the return-trip shape (AddReturnTripUseCase lands it unplaced,
    // pending). It has no slot in the route — but it DOES mean the job's next work is unscheduled,
    // so a done visit's old slot must not answer for it below.
    if (v.scheduledDate === null) {
      if (v.status !== "complete") unplacedLive = true;
      continue;
    }
    const at = `${v.scheduledDate}T${v.scheduledStart ?? "00:00"}`;
    // LIVE (pending / in-progress) visits outrank COMPLETE ones outright: a half-done multi-visit
    // job keys on the visit the tech still has to drive to, not the one already worked — otherwise
    // a Monday visit marked complete pins the job to Monday while its return trip sits on today's
    // board. COMPLETE is the fallback, not discarded: Job.complete() closes open visits to
    // `complete`, so a fully finished job still keeps its slot in the route rather than jumping to
    // the end of the day.
    if (v.status === "complete") {
      if (earliestDone === null || at < earliestDone) earliestDone = at;
    } else if (earliestLive === null || at < earliestLive) {
      earliestLive = at;
    }
  }
  // No dated live visit: if live work exists but is unplaced, the job is honestly "not scheduled"
  // (sorts to the end like every undated job) — only a job with NOTHING left to drive to keeps its
  // finished slot.
  return earliestLive ?? (unplacedLive ? null : earliestDone);
}

/**
 * Earliest first; work with no date at all last.
 *
 * Unplaced work sorts to the END here, which is the opposite of the OFFICE list's default — and
 * right for the opposite reason. The office opens an ascending WHEN list to ask "what have I not
 * put on a day yet"; a technician opens My day to drive it. A job assigned to them with no date is
 * still shown (hiding it is how work goes missing), just not at the top of the route.
 *
 * Ties break on createdAt then id, so the same day always renders in the same order.
 */
export function byAgenda(a: Job, b: Job): number {
  const av = earliestLiveVisitAt(a);
  const bv = earliestLiveVisitAt(b);
  if (av !== bv) {
    if (av === null) return 1;
    if (bv === null) return -1;
    return av < bv ? -1 : 1;
  }
  return tieBreak(a, b);
}

/**
 * The earliest stop ON ONE NAMED DAY — the key the day pager's view orders by.
 *
 * NOT `earliestLiveVisitAt`. That key answers "when is this job's next work", which is the right
 * question for today's agenda and the wrong one for a day being LOOKED AT: a half-done job whose
 * return trip is booked tomorrow 07:00 would sort at the head of yesterday's view, above the stop
 * that was actually worked yesterday at 10:00. A day view is a route as driven (or as booked) —
 * every non-canceled visit dated that day keeps its slot, complete or not.
 *
 * Returns the wall-clock start (`"HH:MM"`, `"00:00"` when the visit is dated but unslotted), or
 * null when nothing lands on the day. Same string-comparison stance as the rest of this file.
 */
export function visitOnAt(job: Job, date: string): string | null {
  let earliest: string | null = null;
  for (const visit of job.props.visits) {
    const v = visit.props;
    if (v.status === "canceled") continue;
    if (v.scheduledDate !== date) continue;
    const at = v.scheduledStart ?? "00:00";
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

/**
 * Comparator for one named day's view: that day's own clock, earliest first.
 *
 * A job with nothing on the day should never reach this (the query filters on the same predicate),
 * but a comparator that misbehaves on unexpected input corrupts the entire sort — so nulls pin to
 * the end, and ties break exactly as byAgenda's do.
 */
export function byVisitOn(date: string): (a: Job, b: Job) => number {
  return (a, b) => {
    const av = visitOnAt(a, date);
    const bv = visitOnAt(b, date);
    if (av !== bv) {
      if (av === null) return 1;
      if (bv === null) return -1;
      return av < bv ? -1 : 1;
    }
    return tieBreak(a, b);
  };
}

function tieBreak(a: Job, b: Job): number {
  const byCreated = a.props.createdAt.getTime() - b.props.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.props.id < b.props.id ? -1 : a.props.id > b.props.id ? 1 : 0;
}
