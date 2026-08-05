/**
 * components/modals/tech-job-modal/visit-steps.ts
 * The visit stepper's view model — pure. No React, no store, no `new Date()` read from inside.
 *
 * Three nodes: Scheduled → On the way → On site. They are a READOUT of what was recorded, never
 * a control:
 *
 *   - Three ~30px targets is the worst tap geometry a gloved one-handed thumb can be given, and
 *     the sheet already has a full-width primary in the foot for advancing.
 *   - Backwards taps are dead by construction. `SetVisitEnrouteUseCase` refuses unless the visit
 *     is still `pending`, and `pending` is unreachable from the field API at all
 *     (FIELD_VISIT_STATUSES is `in_progress` | `complete`). Tappable nodes would look live and
 *     refuse.
 *
 * SKIPPED STAYS SKIPPED. On my way and Arrived are optional — "✓ Mark done" has always worked
 * straight from scheduled, deliberately (see modules/jobs/app/set-visit-status.ts) — and when
 * they are skipped the server leaves `enroute_at` / `started_at` NULL rather than backfilling
 * them. So does this. A node with no stamp renders as `skipped` with no time: a sheet claiming he
 * arrived at 3:00 when nobody tapped is a fabrication in a record that can end up being used to
 * argue with a customer, and null honestly says "nobody recorded an arrival".
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
  readonly key: "scheduled" | "enroute" | "onsite";
  readonly label: string;
  readonly state: VisitStepState;
  /** The recorded time, or null. Null on every node that is not `reached`. */
  readonly time: string | null;
}

const LABELS = {
  scheduled: "Scheduled",
  enroute: "On the way",
  onsite: "On site",
} as const;

/**
 * How far along the visit is, as an index into the three nodes above.
 *
 * A DONE visit is past all three, which is why this returns 3 rather than clamping: every node
 * behind the cursor is then judged on whether it has a stamp, and a job finished without an
 * arrival tap correctly shows two skipped nodes rather than two filled ones.
 */
function cursor(status: string): number {
  if (status === STORE_VISIT_STATUS.SCHEDULED) return 0;
  if (status === STORE_VISIT_STATUS.ENROUTE) return 1;
  if (status === STORE_VISIT_STATUS.ONSITE) return 2;
  return 3; // done (or anything unrecognised — treat as finished, not as scheduled)
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
  };

  return (Object.keys(LABELS) as VisitStep["key"][]).map((key, i) => {
    if (i > at) return { key, label: LABELS[key], state: "pending", time: null };
    if (i === at) return { key, label: LABELS[key], state: "current", time: null };
    const time = stamps[key];
    // Behind the cursor with nothing recorded = skipped. Only the planned Scheduled node is
    // exempt, and only because its stamp comes from the schedule rather than from a tap.
    if (time == null) return { key, label: LABELS[key], state: "skipped", time: null };
    return { key, label: LABELS[key], state: "reached", time };
  });
}
