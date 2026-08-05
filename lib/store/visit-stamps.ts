/**
 * lib/store/visit-stamps.ts
 * The optimistic shape of a visit whose step was just tapped — pure. No store, no network, no
 * `new Date()` read from inside.
 *
 * WHY THIS EXISTS. The optimistic update used to set `status` and nothing else, and the visit
 * stepper reads STATUS AND STAMPS TOGETHER: a node behind the cursor with no stamp renders as
 * `skipped` (see components/modals/tech-job-modal/visit-steps.ts, and the null-is-load-bearing
 * note on Visit itself). So a technician who tapped "I've arrived" and then "Finish job" before
 * the first DTO came back watched the sheet report "On the way — skipped" about a tap he had
 * just made. That is precisely the fabrication the stepper's skipped rule exists to prevent,
 * inverted: not an invented arrival, but a denied one.
 *
 * The stamp carried here is the DEVICE's, and it is provisional — the reconcile from the returned
 * jobDTO replaces it with the server's, which may differ by the round trip. That is the ordinary
 * optimistic contract and it is honest: the tap DID happen, at about this moment.
 *
 * ONLY THE STEP BEING TAKEN IS STAMPED. Arriving does not backfill a drive nobody recorded —
 * "✓ Mark done" has always worked straight from scheduled, the server leaves those columns NULL
 * on that path, and a skipped step must stay visibly skipped. An existing stamp is never
 * overwritten either: a re-tap is not a new arrival.
 */

import { STORE_VISIT_STATUS } from "./dto-mapper";
import type { Visit } from "./types";

/** Which stamp a step tap records. Statuses with no stamp of their own map to null. */
const STAMP_FOR_STATUS: Record<string, keyof Pick<Visit, "enrouteAt" | "startedAt" | "completedAt">> = {
  [STORE_VISIT_STATUS.ENROUTE]: "enrouteAt",
  // There is no `arrived_at` column: `started_at` IS the arrival stamp.
  [STORE_VISIT_STATUS.ONSITE]: "startedAt",
  [STORE_VISIT_STATUS.DONE]: "completedAt",
};

/**
 * The visit as it should read the instant the button is pressed: the new status, plus the stamp
 * that status records — unless the visit already carries one.
 *
 * `scheduled` (↩ Reopen) stamps nothing: it is an office correction, and what the server does to
 * the existing stamps is the server's answer to give.
 */
export function optimisticVisit(visit: Visit, status: string, at: Date): Visit {
  const field = STAMP_FOR_STATUS[status];
  if (!field || visit[field]) return { ...visit, status };
  return { ...visit, status, [field]: at.toISOString() };
}
