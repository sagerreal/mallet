import type { AgentMessage } from "@mallet/ai";
import type { AgentTaskId, CursorPage, Paginated, UserId } from "@mallet/shared/types";
import type { AgentTask, AgentTaskStatus } from "./agent-task";

/** A stored tool execution, replayed instead of re-run when a wake is retried. */
export interface StoredExecution {
  readonly toolUseId: string;
  readonly ok: boolean;
  readonly summary: string;
}

export interface AgentTaskFilter {
  readonly status?: AgentTaskStatus;
}

/**
 * The org is implicit in the transaction this repository was constructed with — no method takes
 * an orgId, so a caller cannot address another tenant even by mistake.
 */
export interface AgentTaskRepository {
  create(input: {
    readonly id: string;
    readonly title: string;
    readonly createdBy: UserId;
    readonly createdByRole: string;
    readonly nextActionAt: Date;
  }): Promise<AgentTask>;

  findById(id: AgentTaskId): Promise<AgentTask | null>;
  list(page: CursorPage, filter?: AgentTaskFilter): Promise<Paginated<AgentTask>>;
  countOpen(): Promise<number>;

  /**
   * Persists every mutable field, guarded on the row's current version.
   *
   * `expectedVersion` MUST be the version the CALLER READ from the database before it built
   * `task` — never `task.props.version`. The aggregate has already incremented itself in memory
   * (possibly more than once, if the caller composed several transitions before saving), so the
   * in-memory version is not a value the row holds; guarding on it would match zero rows and this
   * method would return `false` forever.
   *
   * Returns `false` when no row matched (id + org + not-deleted + `version = expectedVersion`) —
   * meaning somebody else (a human reply, a concurrent wake, a repair script) already wrote a
   * newer version first. The caller MUST treat `false` as a conflict: discard this turn's
   * in-memory work and re-read before trying again. Never retry the same save blindly — that
   * either silently clobbers the other writer's change or fails forever if the row moved on.
   *
   * Returns `true` when exactly one row was updated.
   */
  save(task: AgentTask, expectedVersion: number): Promise<boolean>;

  /** Releases a lease and writes bookkeeping. Returns false when the lease was lost (a race). */
  releaseLease(id: AgentTaskId, leaseId: string): Promise<boolean>;

  appendMessage(taskId: AgentTaskId, message: AgentMessage): Promise<void>;
  loadMessages(taskId: AgentTaskId): Promise<readonly AgentMessage[]>;

  /**
   * Idempotent: a second call with the same toolUseId is a no-op. Nothing is returned — the
   * signature is `Promise<void>` — a caller that needs the stored result calls `findExecution`.
   */
  recordExecution(taskId: AgentTaskId, execution: StoredExecution & { readonly tool: string }): Promise<void>;
  findExecution(toolUseId: string): Promise<StoredExecution | null>;
}
