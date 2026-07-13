import { and, asc, eq, isNull } from "drizzle-orm";
import { tasks } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { keysetAfter } from "@mallet/shared/db/keyset";
import {
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type TaskId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { Task } from "../domain/task";
import type { TaskRepository, TaskFilter } from "../domain/task-repository";
import { toDomain } from "./task-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement.
// orgId is supplied only to stamp inserted rows.
export class DrizzleTaskRepository implements TaskRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: string;
    orgId: string;
    leadId: string | null;
    text: string;
    dueDate: string | null;
  }): Promise<Task> {
    const rows = await this.tx
      .insert(tasks)
      .values({
        id: input.id,
        orgId: this.orgId,
        leadId: input.leadId,
        text: input.text,
        dueDate: input.dueDate,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("task insert returned no row");
    return toDomain(row);
  }

  async findById(id: TaskId): Promise<Task | null> {
    const rows = await this.tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async list(page: CursorPage, filter?: TaskFilter): Promise<Paginated<Task>> {
    const conds = [isNull(tasks.deletedAt)];
    if (filter?.done !== undefined) conds.push(eq(tasks.done, filter.done));
    if (filter?.leadId !== undefined) conds.push(eq(tasks.leadId, filter.leadId));

    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        // Keyset: tasks ordered by (dueDate asc nulls last, createdAt asc, id asc).
        // Cursor encodes (createdAt, id) — used as the tiebreaker within the same day.
        // NOTE: order-by leads with dueDate but the cursor only keys on (createdAt, id) — if
        // dueDate order disagrees with createdAt order across a page boundary, a row can be
        // skipped or duplicated. Separate, subtler bug; needs a multi-key cursor. Out of scope here.
        conds.push(keysetAfter(tasks.createdAt, tasks.id, cursor.value));
      }
    }

    const rows = await this.tx
      .select()
      .from(tasks)
      .where(and(...conds))
      .orderBy(asc(tasks.dueDate), asc(tasks.createdAt), asc(tasks.id))
      .limit(page.limit + 1);

    return buildPage(rows.map(toDomain), page, (task) => ({
      createdAt: task.props.createdAt,
      id: task.props.id,
    }));
  }

  async save(task: Task): Promise<void> {
    const p = task.props;
    await this.tx
      .update(tasks)
      .set({
        leadId: p.leadId,
        text: p.text,
        dueDate: p.dueDate,
        done: p.done,
        updatedAt: p.updatedAt,
      })
      .where(and(eq(tasks.id, p.id), eq(tasks.orgId, this.orgId), isNull(tasks.deletedAt)));
  }

  async remove(id: TaskId, now: Date): Promise<number> {
    const rows = await this.tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.id, id), eq(tasks.orgId, this.orgId), isNull(tasks.deletedAt)))
      .returning();
    return rows.length;
  }
}
