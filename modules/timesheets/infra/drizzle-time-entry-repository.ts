import { and, asc, desc, eq, gte, isNull, isNotNull, lte, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { timeEntries } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetAfterSort, orderFor, decodeSortCursor, encodeSortCursor, sortValueColumn } from "@mallet/shared/db/sort-page";
import { timesheetSortSpec, type TimesheetSort } from "./timesheet-sorts";
import {
  type OrgId,
  type UserId,
  type TimeEntryId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { TimeEntry } from "../domain/time-entry";
import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";
import { toDomain } from "./time-entry-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already sets
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows and as defense-in-depth on every write.
export class DrizzleTimeEntryRepository implements TimeEntryRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
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
  }): Promise<TimeEntry> {
    const rows = await this.tx
      .insert(timeEntries)
      .values({
        id: input.id,
        orgId: this.orgId,
        techUserId: input.techUserId,
        jobId: input.jobId,
        workDate: input.workDate,
        kind: input.kind,
        startTime: input.startTime,
        endTime: input.endTime,
        minutes: input.minutes,
        editedByUserId: input.editedByUserId,
        note: input.note,
        src: input.src,
        status: input.status,
        running: input.running,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("time_entry insert returned no row");
    return toDomain(row);
  }

  async findById(id: TimeEntryId): Promise<TimeEntry | null> {
    const rows = await this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.id, id),
          eq(timeEntries.orgId, this.orgId),
          isNull(timeEntries.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  private async findOpenOfLane(techUserId: UserId, lane: "shift" | "job"): Promise<TimeEntry | null> {
    const rows = await this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.orgId),
          eq(timeEntries.techUserId, techUserId),
          eq(timeEntries.running, true),
          isNull(timeEntries.deletedAt),
          // One lane at a time — the paying shift, or the costing overlay. See migration 0158.
          lane === "job" ? eq(timeEntries.kind, "job") : ne(timeEntries.kind, "job"),
        ),
      )
      // The partial unique index already guarantees at most one match. Ordering newest-first is
      // defence in depth: on a database restored without that index the clock still resolves to
      // the segment most recently started, rather than to whichever row the planner happened to
      // return first.
      .orderBy(desc(timeEntries.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  /** The running shift segment — what pays. */
  async findOpenForTech(techUserId: UserId): Promise<TimeEntry | null> {
    return this.findOpenOfLane(techUserId, "shift");
  }

  /** The running job row — costing only, and allowed to run beside the shift. */
  async findOpenJobForTech(techUserId: UserId): Promise<TimeEntry | null> {
    return this.findOpenOfLane(techUserId, "job");
  }

  /** The filter, once — so count and list can never disagree about what they are describing. */
  private listConds(filter: TimeEntryFilter): SQL[] {
    const conds: SQL[] = [isNull(timeEntries.deletedAt) as SQL];

    if (filter.techUserId !== undefined) {
      conds.push(eq(timeEntries.techUserId, filter.techUserId));
    }
    if (filter.fromDate !== undefined) {
      conds.push(gte(timeEntries.workDate, filter.fromDate));
    }
    if (filter.toDate !== undefined) {
      conds.push(lte(timeEntries.workDate, filter.toDate));
    }
    return conds;
  }

  /**
   * How many entries match — the whole set, not the page.
   *
   * The office panel needs this to tell "this shop has never logged an hour" apart from "nobody
   * worked the week you are looking at". Those render as the same empty grid, and only one of them
   * should offer to set the clock up.
   */
  async count(filter: TimeEntryFilter): Promise<number> {
    const rows = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(timeEntries)
      .where(and(...this.listConds(filter)));
    return rows[0]?.n ?? 0;
  }

  async list(
    filter: TimeEntryFilter,
    page: CursorPage,
    sort?: TimesheetSort,
    sortDir?: "asc" | "desc",
  ): Promise<Paginated<TimeEntry>> {
    const conds = this.listConds(filter);
    const spec = timesheetSortSpec(sort ?? "date", sortDir);

    if (page.cursor) {
      const cursor = decodeSortCursor(page.cursor);
      if (cursor) {
        const after = keysetAfterSort(spec, timeEntries.id, cursor);
        if (after) conds.push(after);
      }
    }

    // The cursor's value is read from the SAME expression ORDER BY leads with, cast to text. The
    // previous version ordered by work_date but keyed the cursor on (created_at, id), so wherever
    // those disagreed — a back-dated correction is enough — a page boundary could skip an entry or
    // repeat one. Hours dropped from payroll is not a cosmetic paging bug.
    const rows = await this.tx
      .select({ row: timeEntries, sortValue: sortValueColumn(spec) })
      .from(timeEntries)
      .where(and(...conds))
      .orderBy(...orderFor(spec, timeEntries.id))
      .limit(page.limit + 1);

    const hasMore = rows.length > page.limit;
    const kept = hasMore ? rows.slice(0, page.limit) : rows;
    const last = kept[kept.length - 1];
    return {
      items: kept.map((r) => toDomain(r.row)),
      nextCursor: hasMore && last ? encodeSortCursor({ value: last.sortValue, id: last.row.id }) : null,
    };
  }

  async save(entry: TimeEntry): Promise<void> {
    const p = entry.props;
    await this.tx
      .update(timeEntries)
      .set({
        jobId: p.jobId,
        workDate: p.workDate,
        kind: p.kind,
        startTime: p.startTime,
        endTime: p.endTime,
        // Both of these were missing while create() carried them, so an edit to a time-off row's
        // LENGTH and every hand-edit signature were silently discarded on update — the row read
        // back with its old minutes and no author. A partial .set() is how a column becomes
        // write-once by accident.
        minutes: p.minutes,
        editedByUserId: p.editedByUserId,
        note: p.note,
        src: p.src,
        status: p.status,
        running: p.running,
        approvedAt: p.approvedAt,
        updatedAt: p.updatedAt,
      })
      .where(
        and(
          eq(timeEntries.id, p.id),
          eq(timeEntries.orgId, this.orgId),
          isNull(timeEntries.deletedAt),
        ),
      );
  }

  async remove(id: TimeEntryId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(timeEntries)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(timeEntries.id, id),
          eq(timeEntries.orgId, this.orgId),
          isNull(timeEntries.deletedAt),
        ),
      )
      .returning();
    return rows.length;
  }

  async unfinishedDates(techUserId: UserId, dates: string[]): Promise<string[]> {
    if (dates.length === 0) return [];
    const rows = await this.tx
      .selectDistinct({ workDate: timeEntries.workDate })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.orgId),
          eq(timeEntries.techUserId, techUserId),
          inArray(timeEntries.workDate, dates),
          eq(timeEntries.status, "draft"),
          isNull(timeEntries.deletedAt),
          // Unfinished either way: the clock is still open, or an end time was never recorded.
          //
          // ONLY OF A PUNCHED ROW. A time-off row is REQUIRED to have no end time (the 0153 shape
          // check), so without this guard every PTO day read as unfinished hours and approval
          // refused the whole week — telling the office to "finish or remove" a day that is
          // already complete, and making a week with any time off unapprovable.
          isNull(timeEntries.minutes),
          or(eq(timeEntries.running, true), isNull(timeEntries.endTime)),
        ),
      );
    return rows.map((r) => r.workDate).sort();
  }

  async approveWeek(techUserId: UserId, dates: string[], now: Date): Promise<number> {
    if (dates.length === 0) return 0;
    const rows = await this.tx
      .update(timeEntries)
      .set({ status: "approved", approvedAt: now, updatedAt: now })
      .where(
        and(
          eq(timeEntries.orgId, this.orgId),
          eq(timeEntries.techUserId, techUserId),
          inArray(timeEntries.workDate, dates),
          eq(timeEntries.status, "draft"),
          isNull(timeEntries.deletedAt),
          // Defence in depth. The use-case refuses the whole week when any day is unfinished, but
          // this predicate means even a direct call cannot approve hours with no end: such an entry
          // has no derivable duration, so it would be approved, pushed, and silently rejected by
          // QuickBooks as `entry_not_finished` with nobody told.
          //
          // A TIME-OFF row satisfies it a different way: its length lives in `minutes` and it has
          // no end time by construction, so it is approvable precisely because that column is set.
          eq(timeEntries.running, false),
          or(isNotNull(timeEntries.endTime), isNotNull(timeEntries.minutes)),
        ),
      )
      .returning();
    return rows.length;
  }
}
