import type { Principal } from "@mallet/identity";
import type { VisitId } from "@mallet/shared/types";
import type { Job } from "../domain/job";

/**
 * modules/jobs/api/visit-to-close.ts
 * Which visit My day's "✓ Complete" actually finishes — the routing decision behind
 * `v1.field.complete`, pulled out here because it is the difference between closing a trip and
 * billing a job that has not happened yet.
 *
 * `field.complete` takes a jobId and no visitId: the agenda card is a job card, and asking a
 * technician which of his own visits he just finished would be a question he has never had to
 * answer. So the endpoint has to choose, and the choice is:
 *
 *   - Nothing outstanding → null. There is no trip left to close, so the caller falls through to
 *     the direct job-complete path (a job with no visits at all, which has no cascade to run).
 *   - The caller's own outstanding visit, earliest first. The overwhelmingly common case, and the
 *     one the sheet's foot already picks.
 *   - Otherwise the earliest outstanding visit on the job, whoever it belongs to.
 *
 * THE LAST CLAUSE IS DELIBERATELY NOT A REFUSAL. It looks like closing somebody else's trip, but
 * it is strictly less authority than this endpoint had before: it used to complete the whole JOB
 * from the same tap, colleague's outstanding visits and all. Two things keep it honest — the
 * cascade in SetVisitStatusUseCase will not complete the job while another visit is open, and the
 * clock tap asks `isAssignedToVisit`, so the hours go to whoever the work belongs to and never to
 * whoever pressed the button.
 *
 * Canceled visits are not outstanding — nobody travelled and nobody worked.
 */
export function visitToClose(job: Job, principal: Principal): VisitId | null {
  const outstanding = job.props.visits
    .filter((v) => v.props.status !== "complete" && v.props.status !== "canceled")
    .slice()
    .sort((a, b) => a.props.position - b.props.position);

  if (outstanding.length === 0) return null;

  const own = outstanding.find((v) => v.props.assigneeUserId === principal.userId);
  return (own ?? outstanding[0])!.props.id;
}
