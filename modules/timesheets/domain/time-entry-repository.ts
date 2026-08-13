import type { TimeEntryId, UserId, CursorPage, Paginated } from "@mallet/shared/types";
import type { TimeEntry } from "./time-entry";
import type { TimesheetSort } from "../infra/timesheet-sorts";

export interface TimeEntryFilter {
  readonly techUserId?: UserId;
  readonly fromDate?: string; // YYYY-MM-DD inclusive
  readonly toDate?: string; // YYYY-MM-DD inclusive
}

// The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
// is constructed with. A caller physically cannot address another tenant's entries.
export interface TimeEntryRepository {
  create(input: {
    id: string;
    orgId: string;
    techUserId: string;
    jobId: string | null;
    workDate: string;
    kind: string;
    startTime: string | null;
    endTime: string | null;
    minutes: number | null;
    note: string;
    src: string;
    status: string;
    running: boolean;
    editedByUserId: string | null;
  }): Promise<TimeEntry>;

  findById(id: TimeEntryId): Promise<TimeEntry | null>;

  /**
   * The technician's single OPEN entry — running, not soft-deleted — or null when the clock is
   * idle. This is what a tap acts on: the clock closes what is open before it starts anything.
   *
   * At most one row can match: the database holds a partial unique index on
   * (org_id, tech_user_id) where running and deleted_at is null. So this is a lookup, not a
   * "pick the most plausible of several" heuristic — two open segments would double-count a
   * technician's paid hours, and that is enforced below the application, not by this method.
   */
  findOpenForTech(techUserId: UserId): Promise<TimeEntry | null>;

  /** How many entries match the filter — the whole set, so a page can say what it is a page of. */
  count(filter: TimeEntryFilter): Promise<number>;

  list(
    filter: TimeEntryFilter,
    page: CursorPage,
    sort?: TimesheetSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<TimeEntry>>;

  save(entry: TimeEntry): Promise<void>;

  // Soft-delete. Returns the number of rows affected (0 = not found or already deleted).
  remove(id: TimeEntryId, now: Date): Promise<number>;

  /**
   * The tech's dates in this range that still hold an UNFINISHED draft entry — running, or with no
   * end time. Approval must refuse those days rather than approve hours that cannot be totalled and
   * that QuickBooks then rejects. Returns distinct work dates, sorted.
   */
  unfinishedDates(techUserId: UserId, dates: string[]): Promise<string[]>;

  // Bulk approve: flip status='approved', set approvedAt=now for a tech's specific dates where
  // status='draft' AND the entry is finished. Returns the count of rows updated.
  approveWeek(techUserId: UserId, dates: string[], now: Date): Promise<number>;
}
