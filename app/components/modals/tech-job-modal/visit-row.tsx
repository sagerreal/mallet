/**
 * components/modals/tech-job-modal/visit-row.tsx
 * One stop, inside the visits slot: the stepper, and ↩ Reopen when the stop has one.
 *
 * The date, the booked length and the elapsed/measured time all live in the PAGER's single line
 * now (visit-meta.ts) — this file used to carry a big when-line under the stepper that repeated
 * the date the pager already showed, and the accordion revision before that hid the stepper
 * behind a Details tap. The slot keeps one treatment: the stepper IS the record, and only one
 * stop's is on screen at a time (visits-sec.tsx owns the movement).
 *
 * THE STEPPER STAYS ON A FINISHED VISIT — that is the moment it matters most. Which steps were
 * recorded and which were skipped is what gets read back weeks later when a customer argues
 * about an arrival time.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { VisitStepper } from "./visit-stepper";
import { seqStepperLabel, type VisitSeq } from "./visit-seq";

interface VisitRowProps {
  visit: Visit;
  /**
   * Which stop this is, when the job has more than one — the stepper's accessible name
   * ("Visit 2 progress"). The visible numbering is the pager's.
   */
  seq?: VisitSeq;
  /**
   * ↩ Reopen — an office correction: it rewrites a visit that already ended, days later, against
   * hours somebody may already have been paid for. Owner/office only. Off-screen copies are
   * unreachable — the slot marks every non-showing slide `inert`.
   */
  canReopen: boolean;
  /**
   * May this viewer move THIS visit forward? The same rule the foot uses (tech-job-modal's
   * `actVisit`). False leaves the stepper the pure readout it has always been.
   */
  canStep: boolean;
  onStatus: (status: string) => void;
}

export function VisitRow({ visit, seq, canReopen, canStep, onStatus }: VisitRowProps) {
  return (
    <div>
      <VisitStepper visit={visit} label={seqStepperLabel(seq)} onJump={canStep ? onStatus : undefined} />
      {canReopen && visit.status === STORE_VISIT_STATUS.DONE ? (
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
      ) : null}
    </div>
  );
}
