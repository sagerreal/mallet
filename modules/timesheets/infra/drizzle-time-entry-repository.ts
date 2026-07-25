import { and, asc, eq, gte, isNull, isNotNull, lte, inArray, or } from "drizzle-orm";
import { timeEntries } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetAfter } from "@mallet/shared/db/keyset";
import {
  buildPage,
  decodeCursor,
  isOk,
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
    startTime: string;
    endTime: string | null;
    note: string;
    src: string;
    status: string;
    running: boolean;
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

  async list(filter: TimeEntryFilter, page: CursorPage): Promise<Paginated<TimeEntry>> {
    const conds = [isNull(timeEntries.deletedAt)];

    if (filter.techUserId !== undefined) {
      conds.push(eq(timeEntries.techUserId, filter.techUserId));
    }
    if (filter.fromDate !== undefined) {
      conds.push(gte(timeEntries.workDate, filter.fromDate));
    }
    if (filter.toDate !== undefined) {
      conds.push(lte(timeEntries.workDate, filter.toDate));
    }

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: ordered by (workDate asc, createdAt asc, id asc).
        // Cursor encodes (createdAt, id) as the tiebreaker.
        // NOTE: order-by leads with workDate but the cursor only keys on (createdAt, id) — if
        // workDate order disagrees with createdAt order across a page boundary, a row can be
        // skipped or duplicated. Separate, subtler bug; needs a multi-key cursor. Out of scope here.
        conds.push(keysetAfter(timeEntries.createdAt, timeEntries.id, cursor.value));
      }
    }

    const rows = await this.tx
      .select()
      .from(timeEntries)
      .where(and(...conds))
      .orderBy(asc(timeEntries.workDate), asc(timeEntries.createdAt), asc(timeEntries.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(toDomain), page, (entry) => ({
      createdAt: entry.props.createdAt,
      id: entry.props.id,
    }));
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
          eq(timeEntries.running, false),
          isNotNull(timeEntries.endTime),
        ),
      )
      .returning();
    return rows.length;
  }
}
