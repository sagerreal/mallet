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

/**
 * Undo one tap, and only that tap — the exact inverse of `optimisticVisit`.
 *
 * `current` is the visit as it stands NOW, `before` the same visit as it stood just before the tap.
 * The status goes back; the stamp the tap wrote is cleared ONLY if the tap is what introduced it.
 *
 * WHY NOT JUST RESTORE THE SNAPSHOT. The failing write's rollback used to reinstate a whole-job
 * snapshot taken before its own tap, which throws away everything that landed in between — a
 * confirmed earlier step, and any line, note or checklist answer saved since. Worse, it reinstated
 * the DEVICE's guess at a departure the server had meanwhile confirmed. Tap "Start driving", tap
 * "On site", and let only the arrival fail: the visit must fall back to enroute carrying the
 * SERVER's departure stamp, because that step really did commit.
 */
export function revertedVisit(current: Visit, before: Visit, status: string): Visit {
  const field = STAMP_FOR_STATUS[status];
  const introduced = field && !before[field];
  return { ...current, status: before.status, ...(introduced ? { [field]: null } : {}) };
}

/** The steps in the order they happen. A visit's status names how far along this list it is. */
const STAMP_ORDER = ["enrouteAt", "startedAt", "completedAt"] as const;

/**
 * The visit as it should read when an incoming answer must NOT be allowed to move it backwards.
 *
 * Two callers, one shape: a stale list snapshot, and the reconcile of a write that a newer tap has
 * already superseded. Both carry a visit that is behind what the device knows.
 *
 * IT IS NOT A BLANKET HOLD, because a superseded write is still the authority on ITS OWN step.
 * Tap "Start driving" then "On site": the drive's response comes back carrying the server's real
 * departure stamp. Refusing all of it would keep the device's guess forever, when the server's is
 * strictly better and does not contradict the arrival at all.
 *
 * So: the local status stands, along with the stamp that status records and every stamp AFTER it —
 * those describe steps the incoming answer has not seen. Stamps for steps BEFORE it are taken from
 * the incoming answer, which recorded them. A status that stamps nothing (↩ Reopen's `scheduled`)
 * holds everything, so a snapshot from before the reopen cannot resurrect the stamps it cleared.
 */
export function heldVisitState(local: Visit, incoming: Visit): Visit {
  const owned = STAMP_FOR_STATUS[local.status];
  const from = owned ? STAMP_ORDER.indexOf(owned) : 0;
  const stamps = Object.fromEntries(
    STAMP_ORDER.map((f, i) => [f, i < from ? incoming[f] : local[f]]),
  );
  return { ...incoming, ...stamps, status: local.status };
}
