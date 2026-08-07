/**
 * components/modals/tech-job-modal/visits-sec.tsx
 * "Your visit(s)" — the sheet's record of where this job has got to.
 *
 * One file per section is this directory's convention (work-order-sec, found-work-sec,
 * checklist-sec, note-feed); this was the one section still inlined in the modal's own render.
 *
 * ONE SEPARATED LIST, and the container owns the separation. Every row used to end in
 * `--space-2xs` — 2px — so a stepper, a date and a ↩ Reopen ran straight into the next visit's
 * stepper and the section read as one continuous block with the first visit's control apparently
 * belonging to the second. The rows are now children of `.vlist`, whose adjacent-sibling rule
 * draws the same hairline every other repeated row in this app separates on (`.nrow`, `.trow`).
 * Putting it on the container rather than on the rows is the point: a placed visit, an
 * awaiting-slot row and the follow-up ask all separate from one another without any of them
 * having to know what comes next.
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
import { VisitCaption, seqAt, type VisitSeq } from "./visit-seq";

/**
 * The placed visits in the order they actually run.
 *
 * A COPY, and a deliberate one. `job.visits` comes off a LEFT JOIN with no ORDER BY
 * (drizzle-job-repository.findById), so the array order is not a promise — and the moment the
 * rows are numbered, printing them in an arbitrary order is not untidy, it is a false statement
 * about which stop came first. Sorting here rather than upstream keeps it to the surface that
 * makes the claim: the modal's own `currentVisit` / `actVisit` pick by STATUS and are unaffected.
 */
function inTimeOrder(placed: readonly Visit[]): Visit[] {
  return [...placed].sort(
    (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.start ?? 0) - (b.start ?? 0),
  );
}

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
  /**
   * The one visit this viewer may move forward — the sheet's `actVisit`, the same visit the foot's
   * primary steps. Only that row's stepper has live nodes; on every other row it stays a readout.
   */
  stepVisitId: string | undefined;
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
  stepVisitId,
  onStatus,
  onAddFollowUp,
}: VisitsSecProps) {
  const rows = inTimeOrder(placed);
  // Every visit the section renders — placed and awaiting alike. It is what the heading
  // pluralises on and what the rows count to. Pluralising on `placed` alone said "Visit" while a
  // placed row and a return trip were both on screen.
  const total = rows.length + awaiting.length;

  return (
    <div className="fsec">
      <div className="fsec-h">
        {/* "Visit", not "Your visit" — the office reads this sheet too, and on a two-visit job the
            second row is somebody else's stop. The heading names the thing, not its owner. */}
        <span>Visit{total > 1 ? "s" : ""}</span>
        {done && <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Done</span>}
      </div>
      {done ? (
        <FinishedJobVisit curVisit={curVisit} isOffice={isOffice} onStatus={onStatus} />
      ) : (
        <div className="vlist">
          {rows.length ? (
            rows.map((v, i) => (
              <VisitRow
                key={v.id}
                visit={v}
                seq={seqAt(i, total)}
                canReopen={isOffice}
                // Only the sheet's own actVisit gets live stepper nodes — the same visit the foot
                // steps, so a two-visit job can never offer two places to move a different stop.
                canStep={v.id === stepVisitId}
                onStatus={(status) => onStatus(v.id, status)}
              />
            ))
          ) : awaiting.length ? null : (
            <div className="empty-att" style={{ marginBottom: "0" }}>
              Not scheduled yet — the office will set the time.
            </div>
          )}
          {awaiting.map((v, i) => (
            <AwaitingSlotRow key={v.id} visit={v} seq={seqAt(rows.length + i, total)} />
          ))}
          {/* Wrapped, not bare: `.vlist`'s rule puts a hairline on each subsequent child, and the
              ask's own resting state is a full-width bordered button. A border-top landing on the
              button itself would recolour its own edge instead of separating it from the record
              above. The wrapper is the row; the button stays the button. */}
          {onAddFollowUp ? (
            <div>
              <FollowUpAsk onBook={onAddFollowUp} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The section's other shape: the job is finished, so there is one visit to read back and no list.
 *
 * THE STEPPER STAYS. Which steps were recorded and which were skipped IS the record of the visit,
 * and it is what gets read back weeks later when a customer argues about an arrival time.
 */
function FinishedJobVisit({
  curVisit,
  isOffice,
  onStatus,
}: Pick<VisitsSecProps, "curVisit" | "isOffice" | "onStatus">) {
  return (
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
  );
}

/**
 * A visit that is still to run but has nowhere to sit on the board yet.
 *
 * No stepper and no controls — there is nothing to step through and nothing here to move. What it
 * carries is the reason, because that is the whole content of the row and the thing that stops
 * the office having to ring the technician to ask what the second visit is for.
 *
 * IT NAMES WHAT IS ACTUALLY MISSING. Two different rows land here — a return trip with no date at
 * all, and the office's half-planned shape (a day with nobody on it, isVisitDatedUnassigned).
 * Telling a technician a dated visit is "waiting on a time" is a small lie he can disprove by
 * looking at the schedule, and small lies are how a screen stops being trusted.
 */
function AwaitingSlotRow({ visit, seq }: { visit: Visit; seq: VisitSeq | undefined }) {
  const dated = Boolean(visit.date);
  return (
    // No padding of its own — `.vlist` separates it from whatever it follows. Its old
    // `paddingTop: --space-2` was this row trying to hold itself off the record above, which is
    // the container's job and was 8px short of doing it anyway. The caption sits OUTSIDE the
    // flex column so its own margin is the gap, exactly as it is on a placed row.
    <div>
      <VisitCaption seq={seq} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <b style={{ fontSize: "var(--type-base)" }}>
          {dated ? `${colLabel(visit.date)} — waiting on a tech` : "Return trip — waiting on a time"}
        </b>
        {visit.scopeNotes ? (
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            {visit.scopeNotes}
          </span>
        ) : null}
      </div>
    </div>
  );
}
