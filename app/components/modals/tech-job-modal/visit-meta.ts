/**
 * components/modals/tech-job-modal/visit-meta.ts
 * The pager's ONE date line — pure.
 *
 * The slot design (Owen, Aug 10) has exactly one place that says when a visit is and how long it
 * ran: the small mono line under "Visit 2 of 3". The big `.vwhen` block that used to sit beneath
 * the stepper repeated the date the pager already carried, and it was called what it was — slop.
 * This file is that line's contents, one string per visit state, so the sentence is testable
 * without rendering the carousel.
 */

import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { MS_PER_MINUTE, MINUTES_PER_HOUR } from "@/lib/time";
import { isVisitPlaced } from "@/lib/store/visit-placement";
import { colLabel, hmLabel, startTimeStr } from "./helpers";
import { stampLabel } from "./visit-steps";

/**
 * How long the visit ACTUALLY took, in hours — `completedAt − startedAt`.
 *
 * Null when either stamp is missing or the pair reads backwards. "✓ Mark done" has always worked
 * straight from scheduled and the server leaves `started_at` NULL on that path, so an
 * unmeasurable visit is an ordinary case, not an error — and absent means nobody recorded it,
 * never zero. (Moved here from visit-row when the `.vwhen` block it fed was removed.)
 */
export function onSiteHours(visit: Visit): number | null {
  if (!visit.startedAt || !visit.completedAt) return null;
  const ms = new Date(visit.completedAt).getTime() - new Date(visit.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return ms / MS_PER_MINUTE / MINUTES_PER_HOUR;
}

/**
 * The line for one visit.
 *
 *   unplaced        "waiting on a time" · dated-unassigned "Wed 13 — waiting on a tech"
 *   scheduled       "Today · 12:00 PM · ~1h 30m"
 *   on the way      "Today · on the way"
 *   on site         "on site 1h 20m · ~1h 30m booked"   (live — the caller re-renders on a tick)
 *   done            "Fri 8 · 1h on site"                (measured; the day alone when nobody
 *                                                        recorded the stamps — never a zero)
 *
 * `now` matters only to the on-site branch; tests pass it, the live caller passes the tick.
 */
export function visitPagerMeta(visit: Visit, now?: Date): string {
  if (!isVisitPlaced(visit)) {
    return visit.date ? `${colLabel(visit.date)} — waiting on a tech` : "waiting on a time";
  }
  if (visit.status === STORE_VISIT_STATUS.DONE) {
    const hours = onSiteHours(visit);
    const day = colLabel(visit.date ?? "");
    return hours === null ? day : `${day} · ${hmLabel(hours)} on site`;
  }
  if (visit.status === STORE_VISIT_STATUS.ONSITE && visit.startedAt) {
    const at = (now ?? new Date()).getTime() - new Date(visit.startedAt).getTime();
    if (!Number.isNaN(at) && at >= 0) {
      const elapsed = Math.floor(at / MS_PER_MINUTE) / MINUTES_PER_HOUR;
      return `on site ${hmLabel(elapsed)} · ~${hmLabel(visit.dur)} booked`;
    }
    return `on site since ${stampLabel(visit.startedAt)}`;
  }
  if (visit.status === STORE_VISIT_STATUS.ENROUTE) {
    return `${colLabel(visit.date ?? "")} · on the way`;
  }
  return `${colLabel(visit.date ?? "")} · ${startTimeStr(visit.start ?? 0)} · ~${hmLabel(visit.dur)}`;
}
