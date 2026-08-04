/**
 * lib/store/job-assignment.ts
 * THE client-side rule for "is this job mine?" — the question that decides whether a technician
 * is shown the money surfaces on a finished job.
 *
 * The SERVER twin is the domain predicate `Job.isAssignedTo(userId)` (modules/jobs/domain/job.ts),
 * which every field-scoped invoice procedure authorizes against
 * (modules/invoicing/api/field-invoice-guard.ts). The two must answer the same question or the
 * field close-out offers a control the server then refuses.
 *
 * KNOWN DIFFERENCE, DELIBERATE and fail-CLOSED: the server also accepts the job's own
 * `assignee_user_id`, which the store's Job carries no field for (only `visits[].techId` survives
 * the DTO). So this predicate is a strict SUBSET of the server's — it can hide a control the
 * server would have allowed, never show one the server will refuse. Hiding a legitimate control is
 * a visible gap somebody reports; showing an illegitimate one is a tap that appears to work and
 * silently rolls back.
 *
 * Placement is NOT part of the rule. `isVisitPlaced` asks whether the board can DRAW the visit;
 * whether the technician ran it is a different question, and a job completed straight from My day
 * has a visit with no start time and real work behind it.
 */

/** The two assignment facts, structurally — so callers holding a partial visit can ask too. */
export interface AssignableVisit {
  readonly techId: string | null;
  readonly status: string;
}

/** Canceled visits carry no assignment — the server's predicate excludes them too. */
const CANCELED = "canceled";

/**
 * Is `userId` on this job — as the assignee of any visit that was not canceled?
 *
 * Returns false for a missing/loading user id, which is the fail-closed default the field surfaces
 * want: until identity resolves, show the reduced view.
 */
export function isJobAssignedTo(
  visits: readonly AssignableVisit[] | undefined,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return (visits ?? []).some((v) => v.techId === userId && v.status !== CANCELED);
}
