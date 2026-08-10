/**
 * components/modals/tech-job-modal/visit-steps.ts
 * The visit stepper's view model — pure. No React, no store, no `new Date()` read from inside.
 *
 * Four nodes: Scheduled → On the way → On site → Done. Every node is a READOUT of what was
 * recorded; a node still AHEAD of the visit is additionally a forward jump (`jumpTo`).
 *
 * DONE IS A READOUT AND NOTHING ELSE. It stopped at "On site" until Aug 2026, and a finished visit
 * that skipped the middle two then rendered pixel-identically to a scheduled one — the only thing
 * on the sheet saying it had ended was the office's ↩ Reopen, which reads as a contradiction
 * rather than as a control. Finishing is a recorded event with a real stamp, so it belongs on the
 * line. It is deliberately NOT a forward jump: the foot already carries Finish as a full-width
 * primary that is always one tap (tech-job-foot.ts, rule 2), and a second finish on a
 * third-of-the-sheet node would be the smaller, worse one.
 *
 * FORWARD ONLY, AND ONLY AHEAD. A technician who forgot to tap "Start driving" is already on the
 * customer's doorstep, and the foot's ladder offered "I've arrived →" only once the visit was
 * enroute — so the one thing he needed was the one thing the sheet would not do. The BACKEND
 * always allowed it: `ALLOWED_TRANSITIONS` lists `pending → in_progress`
 * (modules/jobs/app/set-visit-status.ts), the field API exposes `in_progress`
 * (FIELD_VISIT_STATUSES in modules/jobs/api/visit-clock-tap.ts) and `storeStatusToBackend` maps
 * `"onsite" → "in_progress"`. The strict ladder was purely this sheet's.
 *
 * A node BEHIND the cursor carries `jumpTo: null`, so a backwards tap is not merely refused, it
 * does not exist. Un-finishing a visit rewrites hours somebody may already have been paid for; it
 * is the office's ↩ Reopen, never a tap in a truck.
 *
 * The old objection to tappable nodes was tap GEOMETRY — "three ~30px targets is the worst thing
 * you can give a gloved one-handed thumb" — and it was right about the geometry, not about the
 * control. Each node is a third of the sheet wide and now carries a 44px-tall target
 * (`.vstep-body`). The foot's full-width primary is unchanged and remains the main road.
 *
 * SKIPPED STAYS SKIPPED — including when the skip is deliberate. On my way and Arrived are
 * optional ("✓ Mark done" has always worked straight from scheduled, see
 * modules/jobs/app/set-visit-status.ts) and when they are skipped the server leaves `enroute_at` /
 * `started_at` NULL rather than backfilling them. So does jumping: `stampsFor` writes `startedAt`
 * on `in_progress` and leaves `enrouteAt` exactly as it found it, so a visit that goes straight to
 * On site keeps a NULL departure and this renders that node `skipped`. A sheet claiming he left at
 * 2:41 when nobody tapped is a fabrication in a record that gets read back weeks later to argue
 * with a customer; null honestly says "nobody recorded a departure".
 */

import { timeLabelShort, MINUTES_PER_HOUR } from "@/lib/time";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import type { Visit } from "@/lib/store/types";

/**
 * How a node reads.
 *   reached  — it happened, and we have the stamp
 *   current  — this is where the visit is now
 *   skipped  — the visit moved past this step without anyone recording it
 *   pending  — not there yet
 */
export type VisitStepState = "reached" | "current" | "skipped" | "pending";

export interface VisitStep {
  readonly key: "scheduled" | "enroute" | "onsite" | "done";
  readonly label: string;
  readonly state: VisitStepState;
  /** The recorded time, or null. Null on every node that is not `reached`. */
  readonly time: string | null;
  /**
   * The store visit status tapping this node writes, or null when it is not a forward jump —
   * anything at or behind the cursor, and the Scheduled node always (that direction is ↩ Reopen).
   */
  readonly jumpTo: string | null;
}

const LABELS = {
  scheduled: "Scheduled",
  enroute: "On the way",
  onsite: "On site",
  done: "Done",
} as const;

/**
 * What a node writes when it is tapped from ahead. Scheduled is null: there is no forward jump
 * INTO the start, and going back to it is the office's ↩ Reopen.
 */
const JUMP_TO: Record<VisitStep["key"], string | null> = {
  scheduled: null,
  enroute: STORE_VISIT_STATUS.ENROUTE,
  onsite: STORE_VISIT_STATUS.ONSITE,
  // Not a jump — see the Done note in the file header. The foot owns finishing.
  done: null,
};

/**
 * How far along the visit is, as an index into the four nodes above.
 *
 * A DONE visit is past ALL FOUR, which is why this returns 4 rather than clamping at the Done
 * node: every node behind the cursor is then judged on whether it has a stamp, so a job finished
 * without an arrival tap correctly shows two skipped nodes rather than two filled ones, and the
 * Done node itself reads `reached` with its completedAt stamp rather than `current` with none.
 */
function cursor(status: string): number {
  if (status === STORE_VISIT_STATUS.SCHEDULED) return 0;
  if (status === STORE_VISIT_STATUS.ENROUTE) return 1;
  if (status === STORE_VISIT_STATUS.ONSITE) return 2;
  return 4; // done (or anything unrecognised — treat as finished, not as scheduled)
}

/** An ISO stamp → the app's compact clock ("2:41p"), in the DEVICE's zone. Null stays null. */
export function stampLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return timeLabelShort(at.getHours() + at.getMinutes() / MINUTES_PER_HOUR);
}

/** The visit's scheduled start as a clock label, from the store's fractional hour. */
function plannedLabel(visit: Visit): string | null {
  return visit.start == null ? null : timeLabelShort(visit.start);
}

/**
 * The three nodes for one visit.
 *
 * The Scheduled node is never `skipped` — a placed visit WAS scheduled, and its stamp is the
 * planned start rather than a tap. It carries no time while it is the current node, because the
 * "when" line directly beneath the stepper is already saying it in full.
 */
export function visitSteps(visit: Visit): VisitStep[] {
  const at = cursor(visit.status);
  const stamps: Record<VisitStep["key"], string | null> = {
    scheduled: plannedLabel(visit),
    enroute: stampLabel(visit.enrouteAt),
    // There is no `arrived_at` column: `started_at` IS the arrival stamp.
    onsite: stampLabel(visit.startedAt),
    done: stampLabel(visit.completedAt),
  };

  return (Object.keys(LABELS) as VisitStep["key"][]).map((key, i) => {
    // Ahead of the cursor: a readout AND the one place a forward jump can start from.
    if (i > at) return { key, label: LABELS[key], state: "pending", time: null, jumpTo: JUMP_TO[key] };
    if (i === at) return { key, label: LABELS[key], state: "current", time: null, jumpTo: null };
    const time = stamps[key];
    // Behind the cursor with nothing recorded = skipped. Two nodes are exempt, for the same
    // reason: their state is known from the RECORD rather than from a tap, so a missing stamp
    // means "nobody wrote the time down", not "this never happened". Scheduled is planned by the
    // board; Done is the visit's own status. Calling either skipped would be a false claim.
    if (time == null && key !== "done") {
      return { key, label: LABELS[key], state: "skipped", time: null, jumpTo: null };
    }
    return { key, label: LABELS[key], state: "reached", time, jumpTo: null };
  });
}
