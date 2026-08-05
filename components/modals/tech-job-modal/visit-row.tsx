/**
 * components/modals/tech-job-modal/visit-row.tsx
 * Your visit — the three-node progress stepper, then the one figure that matters right now
 * (when you are due, or how long you have been on site), then ↩ Reopen.
 *
 * The stepper REPLACED a pair of "ARRIVE / ON SITE" columns that printed the plan twice and the
 * state not at all: which state a visit was in could only be inferred from which button happened
 * to be showing. It is a readout — see visit-steps.ts for why the nodes are not tappable and why
 * a skipped step stays visibly skipped.
 *
 * NO STEP BUTTONS LIVE HERE ANY MORE. On my way / Arrived / Finish moved to the sticky foot, where
 * the primary names the next step and a quiet Finish sits under it (see tech-job-foot.ts): two
 * half-width buttons partway up a tall sheet sit past one-handed reach exactly when the sheet is
 * fullest, and the foot's full-width target is the one place a thumb always owns.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { MS_PER_MINUTE, MINUTES_PER_HOUR } from "@/lib/time";
import { useTickingNow } from "@/lib/use-ticking-now";
import { colLabel, hmLabel, startTimeStr } from "./helpers";
import { VisitStepper } from "./visit-stepper";
import { stampLabel } from "./visit-steps";

interface VisitRowProps {
  visit: Visit;
  /**
   * ↩ Reopen — the row's ONLY control, and an office correction: it rewrites a visit that already
   * ended, days later, against hours somebody may already have been paid for. Owner/office only.
   */
  canReopen: boolean;
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
 * The one big figure beneath the stepper. Before arrival it is the appointment — when you are due,
 * and how long the office booked it for; once you are on site it becomes the elapsed figure above.
 */
function WhenLine({ visit }: { visit: Visit }) {
  if (visit.status === STORE_VISIT_STATUS.ONSITE && visit.startedAt) {
    return <OnSiteLine visit={visit} startedAt={visit.startedAt} />;
  }
  return (
    <div className="vwhen">
      <b>
        {colLabel(visit.date ?? "")} · {startTimeStr(visit.start ?? 0)}
      </b>
      <span>about {hmLabel(visit.dur)} on site</span>
    </div>
  );
}

export function VisitRow({ visit, canReopen, onStatus }: VisitRowProps) {
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

  return (
    <div style={{ marginBottom: "var(--space-2xs)" }}>
      <VisitStepper visit={visit} />
      <WhenLine visit={visit} />
      {reopen}
    </div>
  );
}
