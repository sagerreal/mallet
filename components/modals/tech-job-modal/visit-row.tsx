/**
 * components/modals/tech-job-modal/visit-row.tsx
 * Your visit — the three-node progress stepper, then the one figure that matters right now
 * (when you are due, or how long you have been on site), then the step buttons.
 *
 * The stepper REPLACED a pair of "ARRIVE / ON SITE" columns that printed the plan twice and the
 * state not at all: which state a visit was in could only be inferred from which button happened
 * to be showing. It is a readout — see visit-steps.ts for why the nodes are not tappable and why
 * a skipped step stays visibly skipped.
 *
 * The step buttons are the technician's, and they are also how his hours get recorded — each tap
 * moves his clock (travel → on site → back to shop). On-my-way / Arrived are optional; Done is
 * never gated. Only ↩ Reopen is withheld: it is a correction to a visit that already ended, made
 * days later, against hours he may already have been paid for.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { useTickingNow } from "@/lib/use-ticking-now";
import { colLabel, hmLabel, startTimeStr } from "./helpers";
import { VisitStepper } from "./visit-stepper";
import { stampLabel } from "./visit-steps";

interface VisitRowProps {
  visit: Visit;
  quoted: boolean;
  /** ↩ Reopen is an office correction (it can rewrite recorded hours) — owner/office only. */
  canReopen: boolean;
  /**
   * May the viewer MOVE this visit? True for office, and for the tech this visit is assigned to.
   *
   * A job with two visits shows both rows, because "my stop is the second one today" is useful
   * context — but only the viewer's own row gets step buttons. The server refuses a tech acting on
   * a colleague's visit, so rendering the buttons anyway would be a live-looking control that
   * returns an unexplained error.
   */
  canAct: boolean;
  onStatus: (status: string) => void;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/**
 * The one big figure beneath the stepper.
 *
 * Before arrival it is the appointment — when you are due, and how long the office booked it for.
 * Once you are on site it becomes how long you have BEEN there, because that is the number a
 * technician is actually watching, with the booked length demoted to context beside it.
 */
function WhenLine({ visit, now }: { visit: Visit; now: Date }) {
  if (visit.status === "onsite" && visit.startedAt) {
    const ms = now.getTime() - new Date(visit.startedAt).getTime();
    const onSite =
      Number.isNaN(ms) || ms < 0 ? null : hmLabel(Math.floor(ms / MS_PER_MINUTE) / MINUTES_PER_HOUR);
    return (
      <div className="vwhen">
        {/* Genuinely live — masked out of the visual baseline, which would otherwise fail on
            every run as the figure grows. See dynamicRegions in e2e/helpers/ui.ts. */}
        <b data-dynamic>
          {onSite ? `On site ${onSite}` : `On site since ${stampLabel(visit.startedAt)}`}
        </b>
        <span>~{hmLabel(visit.dur)} booked</span>
      </div>
    );
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

export function VisitRow({ visit, quoted, canReopen, canAct, onStatus }: VisitRowProps) {
  const now = useTickingNow();
  const stepP = !quoted;

  // On my way → / Arrived → (scheduled → enroute → onsite). Empty once on site, and empty on
  // somebody else's visit.
  const step = !canAct ? null :
    visit.status === "scheduled" ? (
      <button
        type="button"
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("enroute")}
      >
        On my way →
      </button>
    ) : visit.status === "enroute" ? (
      <button
        type="button"
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("onsite")}
      >
        Arrived →
      </button>
    ) : null;

  // ✓ Mark done / ↩ Reopen. A finished visit shows nothing at all to a technician rather than a
  // button that would be refused — the row is a record at that point, not a control.
  const doneB = !canAct ? null :
    visit.status === "done" ? (
      canReopen ? (
        <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => onStatus("scheduled")}>
          ↩ Reopen
        </button>
      ) : null
    ) : (
      <button
        type="button"
        className={`btn ${visit.status === "onsite" || quoted ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("done")}
      >
        ✓ Mark done
      </button>
    );

  return (
    <div style={{ marginBottom: "var(--space-2xs)" }}>
      <VisitStepper visit={visit} />
      <WhenLine visit={visit} now={now} />
      {(step || doneB) && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          {step}
          {doneB}
        </div>
      )}
    </div>
  );
}
