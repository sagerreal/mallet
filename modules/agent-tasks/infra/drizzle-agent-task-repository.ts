import { and, asc, desc, eq, isNull, sql as rawSql } from "drizzle-orm";
import { agentTasks, agentTaskMessages, agentToolExecutions } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import {
  buildJsonPage, decodeJsonCursor, isOk,
  type AgentTaskId, type CursorPage, type OrgId, type Paginated, type UserId,
} from "@mallet/shared/types";
import type { AgentMessage } from "@mallet/ai";
import type { AgentTask } from "../domain/agent-task";
import type { AgentTaskFilter, AgentTaskRepository, StoredExecution } from "../domain/agent-task-repository";
import { fromMessage, toDomain, toMessage } from "./agent-task-mapper";

/**
 * Constructed with a tenant-scoped transaction (withTenant already set app.current_org_id), so
 * RLS appends `org_id = current_org_id()` to every statement. orgId is supplied only to stamp
 * inserted rows and to carry the explicit eq() that lets the composite indexes be used.
 */
export class DrizzleAgentTaskRepository implements AgentTaskRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(input: {
    id: string;
    title: string;
    createdBy: UserId;
    createdByRole: string;
    nextActionAt: Date;
  }): Promise<AgentTask> {
    const rows = await this.tx
      .insert(agentTasks)
      .values({
        id: input.id,
        orgId: this.orgId,
        title: input.title,
        status: "working",
        nextActionAt: input.nextActionAt,
        origin: "chat",
        createdBy: input.createdBy,
        createdByRole: input.createdByRole,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("agent task insert returned no row");
    return toDomain(row);
  }

  async findById(id: AgentTaskId): Promise<AgentTask | null> {
    const rows = await this.tx
      .select()
      .from(agentTasks)
      .where(and(eq(agentTasks.id, id), eq(agentTasks.orgId, this.orgId), isNull(agentTasks.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async countOpen(): Promise<number> {
    const [row] = await this.tx
      .select({ n: rawSql<number>`count(*)::int` })
      .from(agentTasks)
      .where(
        and(
          eq(agentTasks.orgId, this.orgId),
          isNull(agentTasks.deletedAt),
          rawSql`${agentTasks.status} in ('working','needs_you')`,
        ),
      );
    return row?.n ?? 0;
  }

  async list(page: CursorPage, filter?: AgentTaskFilter): Promise<Paginated<AgentTask>> {
    const conds = [eq(agentTasks.orgId, this.orgId), isNull(agentTasks.deletedAt)];
    if (filter?.status) conds.push(eq(agentTasks.status, filter.status));
    if (page.cursor) {
      const cursor = decodeJsonCursor<{ updatedAt: string; id: string }>(page.cursor);
      if (isOk(cursor)) {
        conds.push(
          rawSql`(${agentTasks.updatedAt}, ${agentTasks.id}) < (${new Date(cursor.value.updatedAt)}, ${cursor.value.id})`,
        );
      }
    }
    const rows = await this.tx
      .select()
      .from(agentTasks)
      .where(and(...conds))
      .orderBy(desc(agentTasks.updatedAt), desc(agentTasks.id))
      .limit(page.limit + 1);
    return buildJsonPage(rows.map(toDomain), page, (task) => ({
      updatedAt: task.props.updatedAt.toISOString(),
      id: task.props.id,
    }));
  }

  /**
   * Optimistic concurrency guard.
   *
   * `expectedVersion` MUST be the version this caller READ from the database before it built
   * `task` — never `task.props.version`. The aggregate has already incremented itself in memory
   * (possibly more than once, if the caller composed several transitions before saving), so the
   * in-memory version is not a value the row currently holds; guarding on it would match zero
   * rows and this method would return `false` forever, turning every save into a silent no-op.
   *
   * Returns `false` when the WHERE clause (id + org + not-deleted + `version = expectedVersion`)
   * matched no row — meaning somebody else (a human reply, a concurrent wake, a repair script)
   * already wrote a newer version first. The caller MUST treat `false` as a conflict: discard
   * this turn's in-memory work and re-read before trying again. Never retry the same save
   * blindly — that either silently clobbers the other writer's change or fails forever if the
   * row moved on without you.
   *
   * Returns `true` when exactly one row was updated.
   */
  async save(task: AgentTask, expectedVersion: number): Promise<boolean> {
    const p = task.props;
    const rows = await this.tx
      .update(agentTasks)
      .set({
        title: p.title,
        status: p.status,
        nextActionAt: p.nextActionAt,
        nextActionNote: p.nextActionNote,
        version: p.version,
        attempts: p.attempts,
        lastError: p.lastError,
        transcriptBytes: p.transcriptBytes,
        stepsTaken: p.stepsTaken,
        updatedAt: p.updatedAt,
      })
      .where(
        and(
          eq(agentTasks.id, p.id),
          eq(agentTasks.orgId, this.orgId),
          eq(agentTasks.version, expectedVersion),
          isNull(agentTasks.deletedAt),
        ),
      )
      .returning({ id: agentTasks.id });
    return rows.length > 0;
  }

  /**
   * Releases the lease this worker holds. The `lease_id` predicate is the fencing token: a worker
   * whose lease expired mid-LLM-call must NOT clobber its successor's state, so a 0-row result
   * means "I lost the lease" and the caller discards its turn.
   *
   * Deliberately does not touch next_action_at — that column belongs to the tenant transaction
   * (schedule_next_step writes it), and a bookkeeping write must never undo the agent's pacing.
   */
  async releaseLease(id: AgentTaskId, leaseId: string): Promise<boolean> {
    const rows = await this.tx
      .update(agentTasks)
      .set({ leaseId: null, lockedUntil: null })
      .where(
        and(eq(agentTasks.id, id), eq(agentTasks.orgId, this.orgId), eq(agentTasks.leaseId, leaseId)),
      )
      .returning({ id: agentTasks.id });
    return rows.length > 0;
  }

  async appendMessage(taskId: AgentTaskId, message: AgentMessage): Promise<void> {
    const row = fromMessage(message);
    await this.tx.insert(agentTaskMessages).values({
      orgId: this.orgId,
      taskId,
      role: row.role,
      kind: row.kind,
      blocks: row.blocks as never,
    });
  }

  async loadMessages(taskId: AgentTaskId): Promise<readonly AgentMessage[]> {
    const rows = await this.tx
      .select()
      .from(agentTaskMessages)
      .where(and(eq(agentTaskMessages.orgId, this.orgId), eq(agentTaskMessages.taskId, taskId)))
      .orderBy(asc(agentTaskMessages.seq));
    return rows.map(toMessage);
  }

  /** ON CONFLICT DO NOTHING: recording the same tool_use twice is a replay, not an error. */
  async recordExecution(
    taskId: AgentTaskId,
    execution: StoredExecution & { tool: string },
  ): Promise<void> {
    await this.tx
      .insert(agentToolExecutions)
      .values({
        orgId: this.orgId,
        taskId,
        toolUseId: execution.toolUseId,
        tool: execution.tool,
        ok: execution.ok ? "ok" : "error",
        summary: execution.summary,
      })
      .onConflictDoNothing({ target: [agentToolExecutions.orgId, agentToolExecutions.toolUseId] });
  }

  async findExecution(toolUseId: string): Promise<StoredExecution | null> {
    const rows = await this.tx
      .select()
      .from(agentToolExecutions)
      .where(
        and(
          eq(agentToolExecutions.orgId, this.orgId),
          eq(agentToolExecutions.toolUseId, toolUseId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? { toolUseId: row.toolUseId, ok: row.ok === "ok", summary: row.summary } : null;
  }
}
