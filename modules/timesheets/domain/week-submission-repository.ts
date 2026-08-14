import type { UserId } from "@mallet/shared/types";
import type { WeekSubmission } from "./week-submission";

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with, exactly as TimeEntryRepository. A caller physically cannot address
// another tenant's attestations.
export interface WeekSubmissionRepository {
  /** The one row for (tech, week), or null — the unique index guarantees at most one. */
  findFor(techUserId: UserId, weekStart: string): Promise<WeekSubmission | null>;

  /**
   * Every technician's row for ONE week.
   *
   * The office read used to be per-technician because only one week card was ever open at a time.
   * The crew grid shows the whole crew at once, and status is the column an approver scans first —
   * asking per row would be a query per person for a fact the same index already answers in one.
   * Bounded by crew size; a week is a payroll period, not a feed.
   */
  findForWeek(weekStart: string): Promise<readonly WeekSubmission[]>;

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
