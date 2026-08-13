import type { UserId } from "@mallet/shared/types";
import type { WeekSubmission } from "./week-submission";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, exactly as TimeEntryRepository. A caller physically cannot address
// another tenant's attestations.
export interface WeekSubmissionRepository {
  /** The one row for (tech, week), or null — the unique index guarantees at most one. */
  findFor(techUserId: UserId, weekStart: string): Promise<WeekSubmission | null>;

  /** Every submission for the caller's org inside [fromWeek, toWeek] — the office review read. */
  listWeeks(fromWeek: string, toWeek: string): Promise<WeekSubmission[]>;

  /**
   * Insert-or-return on the unique (org, tech, week): a replayed submit finds the existing
   * row instead of erroring — idempotency by construction, not by retry handling.
   */
  claim(input: {
    id: string;
    orgId: string;
    techUserId: string;
    weekStart: string;
    submittedAt: Date;
  }): Promise<{ submission: WeekSubmission; created: boolean }>;

  save(submission: WeekSubmission): Promise<void>;
}
