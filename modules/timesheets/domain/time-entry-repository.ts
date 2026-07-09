import type { TimeEntryId, UserId, CursorPage, Paginated } from "@mallet/shared/types";
import type { TimeEntry } from "./time-entry";

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
    startTime: string;
    endTime: string | null;
    note: string;
    src: string;
    status: string;
    running: boolean;
  }): Promise<TimeEntry>;

  findById(id: TimeEntryId): Promise<TimeEntry | null>;

  list(filter: TimeEntryFilter, page: CursorPage): Promise<Paginated<TimeEntry>>;

  save(entry: TimeEntry): Promise<void>;

  // Soft-delete. Returns the number of rows affected (0 = not found or already deleted).
  remove(id: TimeEntryId, now: Date): Promise<number>;

  // Bulk approve: flip status='approved', set approvedAt=now for a tech's specific dates where
  // status='draft'. Returns the count of rows updated.
  approveWeek(techUserId: UserId, dates: string[], now: Date): Promise<number>;
}
