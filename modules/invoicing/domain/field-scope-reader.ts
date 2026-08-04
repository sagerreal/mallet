import type { JobId, UserId } from "@mallet/shared/types";
import type { JobStatus } from "@mallet/jobs";

/**
 * What the field guard needs to know about a job before it will let a technician transact on it.
 *
 * A narrow read seam over the jobs module, like `JobReader` next door — invoicing never imports
 * jobs internals, only its public types and this port.
 */
export interface FieldJobScope {
  readonly jobId: JobId;
  readonly status: JobStatus;
  /**
   * The answer to `Job.isAssignedTo(userId)` — the job's own assignee OR the assignee of any
   * non-canceled visit on it.
   *
   * Deliberately JOB-level, not visit-level. The invoice is raised from the job, there is no
   * per-visit bill, and on a two-visit job whichever assigned technician is at the door when the
   * customer pays must be able to collect. `isAssignedToVisit` is the right question for moving a
   * visit and the wrong one here.
   *
   * The predicate is answered by the domain object, never re-expressed as SQL: a second copy of
   * an authorization rule is a second place for it to drift.
   */
  readonly assignedToCaller: boolean;
}

export interface FieldScopeReader {
  /** The job's field scope, or null when the job is absent or soft-deleted. */
  forJob(jobId: JobId, userId: UserId): Promise<FieldJobScope | null>;
}
