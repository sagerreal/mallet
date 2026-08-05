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

/** Zero-padded, lexicographically sortable. Null when the job has no live, dated visit. */
export function earliestLiveVisitAt(job: Job): string | null {
  let earliest: string | null = null;
  for (const visit of job.props.visits) {
    const v = visit.props;
    // Canceled visits are not work. A COMPLETE one still is: Job.complete() closes its open visits
    // to `complete`, so a finished job keeps its slot in the route rather than jumping to the end.
    if (v.status === "canceled" || v.scheduledDate === null) continue;
    const at = `${v.scheduledDate}T${v.scheduledStart ?? "00:00"}`;
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
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
  const byCreated = a.props.createdAt.getTime() - b.props.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.props.id < b.props.id ? -1 : a.props.id > b.props.id ? 1 : 0;
}
