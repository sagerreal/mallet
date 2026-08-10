/**
 * components/modals/tech-job-modal/tech-job-foot.ts
 * The tech sheet's foot, as a view model — pure. No React, no store, no `new Date()` read from
 * inside, and no JSX: it answers what the two buttons SAY and which handler each one calls.
 *
 * The sheet grammar allows ONE loud primary, so what that primary is doing is a decision, and it
 * was a forty-line ladder inside the modal's render. Out here it is directly testable, which is
 * the point — the branch below is the difference between a technician closing a job and a
 * technician tapping a button that does nothing.
 *
 * THE RULES IT ENCODES
 *
 * 1. ON AN OPEN JOB THE PRIMARY IS THE NEXT STEP — "Start driving →" / "I've arrived →" /
 *    "Finish job →" — one full-width target where the thumb already rests. It used to be a plain
 *    "Done" that only dismissed the sheet, while the actual workflow lived in a pair of
 *    half-width buttons somewhere up the page; on a tall sheet those sit past one-handed reach
 *    exactly when the record is fullest.
 *
 * 2. FINISH IS ALWAYS ONE TAP. Where the primary is not yet Finish, a quiet "Finish job →" sits
 *    beneath it. On my way and Arrived are optional and always have been (the server allows
 *    pending → complete deliberately), so the sheet must never make a man in a customer's kitchen
 *    tap "on the way" before he can close the job he has just finished. No confirmation dialog:
 *    finishing is reversible by the office, and a modal on top of a modal in a truck is worse.
 *
 * 3. ON A DONE JOB the foot carries the close-out branch's terminal action instead. An unpriced
 *    estimate never gets a billing foot — its close-out is the scope handoff.
 *
 * 4. THERE IS ALWAYS A PRIMARY. Anything not covered above keeps the plain Done, so the sheet is
 *    never dismissable only via the shell's small ✕.
 */

import type { Invoice, Job, Lead, Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { fmt$ } from "@/lib/format";
import { invDue, jobTotal } from "./helpers";
import { doneFootAction } from "./done-block";

/** One foot button: what it says, and what it does. */
export interface FootAction {
  readonly label: string;
  readonly run: () => void;
}

export interface FootActions {
  /** The loud full-width button. Never null — see rule 4. */
  readonly primary: FootAction;
  /** The quiet button beneath it, when the primary is not already Finish. */
  readonly quiet: FootAction | null;
}

/** Everything the branch reads. Data only — no callbacks, no React. */
export interface FootFacts {
  readonly job: Job;
  readonly lead: Lead | undefined;
  readonly invoice: Invoice | undefined;
  /** Owner/office. Gates the hand-off branch, which is an office write. */
  readonly isOffice: boolean;
  /** May this viewer collect on this job — the office, or the tech assigned to it. */
  readonly canTakePayment: boolean;
  /** A done, unpriced ESTIMATE: a finished scoping visit, which has no bill to settle. */
  readonly scoping: boolean;
  readonly done: boolean;
  /**
   * The visit this foot MOVES, if any. The viewer's own visit first; owner/office may move the
   * job's current one either way. A technician looking at a colleague's visit gets neither the
   * step nor the finish — the server refuses both, so a live-looking button would just error.
   */
  readonly actVisit: Visit | undefined;
}

/** What each button does. Named so a test can assert which one a tap reached. */
export interface FootHandlers {
  readonly setVisitStatus: (visitId: string, status: string) => void;
  readonly chargeOnFile: () => void;
  readonly openCloseOut: () => void;
  readonly sendToOffice: () => void;
  /** Close the sheet — the fallback primary. */
  readonly dismiss: () => void;
}

/**
 * Does finishing THIS visit finish the job?
 *
 * The write never needed to ask — `SetVisitStatusUseCase` derives job status from the visit set,
 * so completing visit 1 of 2 already leaves the job open. The LABEL needed to ask, because it was
 * saying "Finish job" while doing no such thing, on the one screen a technician reads before
 * telling a customer whether anyone is coming back.
 *
 * An unplaced visit counts. A follow-up booked from the field has no date and no assignee yet —
 * that is exactly what makes it outstanding, and skipping it here would restore the lie for the
 * one case this branch exists to serve.
 */
function finishLabel(facts: FootFacts): string {
  const others = (facts.job.visits ?? []).filter(
    (v) => v.id !== facts.actVisit?.id && v.status !== STORE_VISIT_STATUS.DONE,
  );
  return others.length > 0 ? "Finish visit →" : "Finish job →";
}

/** The step the primary advances to, or null when the visit is past stepping. */
function nextStepAction(actVisit: Visit, on: FootHandlers): FootAction | null {
  if (actVisit.status === STORE_VISIT_STATUS.SCHEDULED) {
    return {
      label: "Start driving →",
      run: () => on.setVisitStatus(actVisit.id, STORE_VISIT_STATUS.ENROUTE),
    };
  }
  if (actVisit.status === STORE_VISIT_STATUS.ENROUTE) {
    return {
      label: "I've arrived →",
      run: () => on.setVisitStatus(actVisit.id, STORE_VISIT_STATUS.ONSITE),
    };
  }
  return null;
}

/** The terminal action of a DONE job's close-out branch, or null when it has none. */
function closeOutAction(facts: FootFacts, on: FootHandlers): FootAction | null {
  const { job, lead, invoice, isOffice, canTakePayment, scoping, done } = facts;
  if (!done || !canTakePayment || scoping) return null;

  const kind = doneFootAction(job, lead, invoice, isOffice);
  const card = lead?.card;
  const due = invoice ? invDue(invoice) : jobTotal(job);

  if (kind === "charge" && card) {
    return {
      label: `Charge ${fmt$(due)} to ${card.brand} ···· ${card.last4}`,
      run: on.chargeOnFile,
    };
  }
  if (kind === "collect") return { label: "Take payment →", run: on.openCloseOut };
  if (kind === "sendoffice") return { label: "Send to the office to bill", run: on.sendToOffice };
  return null;
}

/**
 * The sheet's two foot buttons, for this job, this viewer and this moment.
 */
export function footActions(facts: FootFacts, on: FootHandlers): FootActions {
  const closeOut = closeOutAction(facts, on);
  if (closeOut) return { primary: closeOut, quiet: null };

  const { actVisit } = facts;
  // A visit that is already done has no Finish. The caller filters it out too (tech-job-modal's
  // `movable`), and the rule belongs here as well: this file's whole job is that the primary
  // never says one thing and does another, and "Finish visit →" writing `done` onto a done visit
  // is the purest form of that — a live-looking button that takes the tap and changes nothing.
  const finish: FootAction | null =
    actVisit && actVisit.status !== STORE_VISIT_STATUS.DONE
      ? {
          label: finishLabel(facts),
          run: () => on.setVisitStatus(actVisit.id, STORE_VISIT_STATUS.DONE),
        }
      : null;
  const next = actVisit ? nextStepAction(actVisit, on) : null;

  if (next) return { primary: next, quiet: finish };
  if (finish) return { primary: finish, quiet: null };
  return { primary: { label: "Done", run: on.dismiss }, quiet: null };
}
