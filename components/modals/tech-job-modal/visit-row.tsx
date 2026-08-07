/**
 * components/modals/tech-job-modal/visit-row.tsx
 * Your visit — the three-node progress stepper, then the one figure that matters right now
 * (when you are due, or how long you have been on site), then ↩ Reopen.
 *
 * The stepper REPLACED a pair of "ARRIVE / ON SITE" columns that printed the plan twice and the
 * state not at all: which state a visit was in could only be inferred from which button happened
 * to be showing. It reads out what was recorded and, on the viewer's OWN visit, lets them jump
 * forward to a step that has not happened yet — see visit-steps.ts for why only the nodes ahead
 * are live and why a skipped step stays visibly skipped.
 *
 * THE FOOT IS STILL THE MAIN ROAD. On my way / Arrived / Finish live in the sticky foot, where the
 * primary names the next step and a quiet Finish sits under it (see tech-job-foot.ts): two
 * half-width buttons partway up a tall sheet sit past one-handed reach exactly when the sheet is
 * fullest, and the foot's full-width target is the one place a thumb always owns. The stepper adds
 * the one move the foot's ladder cannot express — SKIPPING a step — and changes nothing else.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { MS_PER_MINUTE, MINUTES_PER_HOUR } from "@/lib/time";
import { useTickingNow } from "@/lib/use-ticking-now";
import { colLabel, hmLabel, startTimeStr } from "./helpers";
import { VisitStepper } from "./visit-stepper";
import { stampLabel } from "./visit-steps";
import { VisitCaption, seqStepperLabel, type VisitSeq } from "./visit-seq";

interface VisitRowProps {
  visit: Visit;
  /**
   * Which stop this is, when the section renders more than one. Undefined on a one-visit job —
   * see visit-seq.ts for why nothing is printed then.
   */
  seq?: VisitSeq;
  /**
   * ↩ Reopen — an office correction: it rewrites a visit that already ended, days later, against
   * hours somebody may already have been paid for. Owner/office only.
   */
  canReopen: boolean;
  /**
   * May this viewer move THIS visit forward? The same rule the foot uses (tech-job-modal's
   * `actVisit`): your own visit, or the job's current one if you are owner/office. False leaves
   * the stepper the pure readout it has always been — a technician looking at a colleague's stop
   * gets no live node, because the server would refuse the write anyway.
   */
  canStep: boolean;
  onStatus: (status: string) => void;
}

/**
 * How long you have BEEN here — the number a technician on site is actually watching, with the
 * booked length demoted to context beside it.
 *
 * Its own component so that `useTickingNow` — and the interval behind it — exists only while a
 * visit is on site. Called from the row it ran on every visit of the job, all day, to feed a
 * figure two of the three states never render.
 */
function OnSiteLine({ visit, startedAt }: { visit: Visit; startedAt: string }) {
  const now = useTickingNow();
  const ms = now.getTime() - new Date(startedAt).getTime();
  const onSite =
    Number.isNaN(ms) || ms < 0 ? null : hmLabel(Math.floor(ms / MS_PER_MINUTE) / MINUTES_PER_HOUR);

  return (
    <div className="vwhen">
      {/* Genuinely live — masked out of the visual baseline, which would otherwise fail on
          every run as the figure grows. See dynamicRegions in e2e/helpers/ui.ts. */}
      <b data-dynamic>{onSite ? `On site ${onSite}` : `On site since ${stampLabel(startedAt)}`}</b>
      <span>~{hmLabel(visit.dur)} booked</span>
    </div>
  );
}

/**
 * How long the visit ACTUALLY took, in hours — `completedAt − startedAt`.
 *
 * Null when either stamp is missing or the pair reads backwards. "✓ Mark done" has always worked
 * straight from scheduled and the server leaves `started_at` NULL on that path (see
 * set-visit-status.ts), so an unmeasurable visit is an ordinary case, not an error — and absent
 * means nobody recorded it, never zero.
 */
function onSiteHours(visit: Visit): number | null {
  if (!visit.startedAt || !visit.completedAt) return null;
  const ms = new Date(visit.completedAt).getTime() - new Date(visit.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return ms / MS_PER_MINUTE / MINUTES_PER_HOUR;
}

/**
 * A finished visit — the figure that stays true after everyone has gone home.
 *
 * IT USED TO PRINT THE BOOKED START, in the biggest text on the row, two lines under a stepper
 * saying the technician actually arrived at 9:22p. The row contradicted itself, and the booked
 * start was ALREADY on screen: the stepper's Scheduled node carries exactly that number
 * (plannedLabel, visit-steps.ts). So the headline was simultaneously a duplicate and the one
 * figure on the row that describes something which did not happen.
 *
 * What replaces it is the only figure this row can add to the stamps above it: how long the
 * technician was actually there. That is the number the shop bills against, pays against and
 * argues about weeks later, and it is the natural terminal of the live line — the elapsed figure
 * counts up while he is on site and freezes here, in the same words and the same format, so
 * nothing jumps at the moment the visit ends.
 *
 * When it cannot be measured the row falls back to the DAY and says nothing about duration. The
 * same rule the stepper's skipped nodes follow: a sheet that printed a length nobody recorded
 * would be a fabrication in a record that gets read back in an argument with a customer.
 */
function DoneLine({ visit }: { visit: Visit }) {
  const hours = onSiteHours(visit);
  const day = colLabel(visit.date ?? "");
  const booked = `~${hmLabel(visit.dur)} booked`;

  if (hours === null) {
    return (
      <div className="vwhen">
        <b>{day}</b>
        <span>{booked}</span>
      </div>
    );
  }
  return (
    <div className="vwhen">
      <b>On site {hmLabel(hours)}</b>
      {/* The booked length stays, demoted and LABELLED as the plan — the same relationship it has
          to the live figure. A booked duration sitting unlabelled under a measured one reads as a
          measurement of what happened when it is nothing of the kind. */}
      <span>
        {day} · {booked}
      </span>
    </div>
  );
}

/**
 * The one big figure beneath the stepper. Before arrival it is the appointment — when you are due,
 * and how long the office booked it for; once you are on site it becomes the elapsed figure above;
 * once the visit is over it freezes at what that elapsed figure reached.
 */
function WhenLine({ visit }: { visit: Visit }) {
  if (visit.status === STORE_VISIT_STATUS.ONSITE && visit.startedAt) {
    return <OnSiteLine visit={visit} startedAt={visit.startedAt} />;
  }
  if (visit.status === STORE_VISIT_STATUS.DONE) return <DoneLine visit={visit} />;
  return (
    <div className="vwhen">
      <b>
        {colLabel(visit.date ?? "")} · {startTimeStr(visit.start ?? 0)}
      </b>
      <span>about {hmLabel(visit.dur)} on site</span>
    </div>
  );
}

export function VisitRow({ visit, seq, canReopen, canStep, onStatus }: VisitRowProps) {
  const reopen =
    canReopen && visit.status === STORE_VISIT_STATUS.DONE ? (
      <div style={{ display: "flex", marginTop: "var(--space-3)" }}>
        <button
          type="button"
          className="btn ghost"
          style={{ flex: 1 }}
          onClick={() => onStatus(STORE_VISIT_STATUS.SCHEDULED)}
        >
          ↩ Reopen
        </button>
      </div>
    ) : null;

  // No margin of its own. The row is one child of the section's `.vlist`, and separation from
  // whatever follows it — another visit, an awaiting-slot row, the follow-up ask — belongs to the
  // container. It used to carry `marginBottom: --space-2xs`, which is 2px: two complete visit
  // records abutted, so this row's ↩ Reopen sat directly above the NEXT row's stepper and read as
  // its control.
  return (
    <div>
      <VisitCaption seq={seq} />
      <VisitStepper visit={visit} label={seqStepperLabel(seq)} onJump={canStep ? onStatus : undefined} />
      <WhenLine visit={visit} />
      {reopen}
    </div>
  );
}
