/**
 * components/modals/tech-job-modal/visits-sec.tsx
 * "Your visit(s)" — the sheet's record of where this job has got to.
 *
 * One file per section is this directory's convention (work-order-sec, found-work-sec,
 * checklist-sec, note-feed); this was the one section still inlined in the modal's own render.
 *
 * Two shapes:
 *   - OPEN job: one VisitRow per PLACED visit. Both rows show on a two-visit job, because "my
 *     stop is the second one today" is useful context; only the office gets a control on either.
 *   - DONE job: the stepper on the visit that ran, the date and booked length beside it, and the
 *     office's ↩ Reopen. THE STEPPER STAYS ON A FINISHED VISIT — this is the moment it matters
 *     most. Which steps were recorded and which were skipped IS the record of the visit, and it
 *     is what gets read back weeks later when a customer argues about an arrival time.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { colLabel, hmLabel } from "./helpers";
import { VisitRow } from "./visit-row";
import { VisitStepper } from "./visit-stepper";
import { FollowUpAsk } from "./follow-up-ask";

interface VisitsSecProps {
  /** The job's PLACED visits — the tech never sees an unplaced "Invalid Date" row. */
  placed: readonly Visit[];
  /**
   * Unplaced visits still to run — a return trip booked from the field, waiting on the office to
   * set a time. These are NOT hidden like a half-typed office row would be: this technician
   * created them, so a booking that vanished from the sheet reads as a tap that did nothing.
   */
  awaiting: readonly Visit[];
  /** The job's current visit, if it has one. */
  curVisit: Visit | undefined;
  done: boolean;
  /** Owner/office. ↩ Reopen writes a VISIT status, which has no field endpoint. */
  isOffice: boolean;
  onStatus: (visitId: string, status: string) => void;
  /** Books a return trip. Absent when this viewer may not (the server refuses off-job callers). */
  onAddFollowUp?: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}

export function VisitsSec({
  placed,
  awaiting,
  curVisit,
  done,
  isOffice,
  onStatus,
  onAddFollowUp,
}: VisitsSecProps) {
  return (
    <div className="fsec">
      <div className="fsec-h">
        {/* "Visit", not "Your visit" — the office reads this sheet too, and on a two-visit job the
            second row is somebody else's stop. The heading names the thing, not its owner. */}
        <span>Visit{placed.length > 1 ? "s" : ""}</span>
        {done && <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Done</span>}
      </div>
      {done ? (
        <>
          {curVisit ? <VisitStepper visit={curVisit} /> : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            {/* The DATE only. The booked length ("~1h 30m on site") was noise here: on a finished
                visit the stepper above already carries the real stamps, and a BOOKED duration
                sitting under them reads as a measurement of what happened when it is nothing of
                the kind. */}
            <span className="muted" style={{ fontSize: "var(--type-base)" }}>
              {curVisit ? colLabel(curVisit.date) : "Completed"}
            </span>
            {/* Office only, and only when there IS a placed visit to move. A job completed
                straight from My Day has none, and this button took the tap and did nothing. */}
            {isOffice && curVisit && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => onStatus(curVisit.id, STORE_VISIT_STATUS.SCHEDULED)}
              >
                ↩ Reopen
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {placed.length ? (
            placed.map((v) => (
              <VisitRow key={v.id} visit={v} canReopen={isOffice} onStatus={(status) => onStatus(v.id, status)} />
            ))
          ) : awaiting.length ? null : (
            <div className="empty-att" style={{ marginBottom: "0" }}>
              Not scheduled yet — the office will set the time.
            </div>
          )}
          {awaiting.map((v) => (
            <AwaitingSlotRow key={v.id} visit={v} />
          ))}
          {onAddFollowUp ? <FollowUpAsk onBook={onAddFollowUp} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * A return trip with no date on it yet.
 *
 * No stepper and no controls — there is nothing to step through and nothing here to move. What it
 * carries is the reason, because that is the whole content of the row and the thing that stops
 * the office having to ring the technician to ask what the second visit is for.
 */
function AwaitingSlotRow({ visit }: { visit: Visit }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        paddingTop: "var(--space-2)",
      }}
    >
      <b style={{ fontSize: "var(--type-base)" }}>Return trip — waiting on a time</b>
      {visit.scopeNotes ? (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {visit.scopeNotes}
        </span>
      ) : null}
    </div>
  );
}
