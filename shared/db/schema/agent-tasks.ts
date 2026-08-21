import {
  pgTable, uuid, text, integer, bigserial, jsonb, timestamp, index, unique, check, foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { JsonValue } from "@mallet/shared/ports";
import { orgs } from "./orgs";
import { users } from "./users";

/**
 * shared/db/schema/agent-tasks.ts
 * The AI employee's durable work. Three tables that change together.
 *
 * A task is a conversation that outlives a request. `next_action_at` is when the runner should
 * wake it; `lease_id` + `locked_until` are how exactly one worker owns a wake (the outbox's
 * at-least-once claim is safe there because handlers are idempotent — an agent turn calls an LLM
 * and sends texts, so it is not).
 */
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // text + check, never pgEnum — the codebase's convention, and a check is alterable.
    status: text("status").notNull().default("working"),
    // When to wake it. NULL means "not scheduled" — the runner never claims it.
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    // What the agent said it would do next, or why it stopped. Shown on the card.
    nextActionNote: text("next_action_note"),
    origin: text("origin").notNull().default("chat"),
    // The REAL user who filed it. The runner acts as this person, inherits their RBAC, and
    // stamps them as the actor on any write — a sentinel id would put a fake actor in the
    // money ledger (payments.recorded_by_user_id deliberately has no FK, so it would not even
    // fail loudly).
    createdBy: uuid("created_by").notNull(),
    // Snapshotted so a demotion cannot silently widen what a parked task may do on waking.
    createdByRole: text("created_by_role").notNull(),
    // Optimistic concurrency between a human replying and the runner resuming.
    version: integer("version").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    leaseId: uuid("lease_id"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    // Cheap guards against an unbounded conversation and a self-rescheduling loop.
    transcriptBytes: integer("transcript_bytes").notNull().default(0),
    stepsTaken: integer("steps_taken").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "agent_tasks_org_creator_fk",
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }),
    check("agent_tasks_status_ck", sql`${t.status} in ('working','needs_you','done','closed')`),
    check("agent_tasks_origin_ck", sql`${t.origin} in ('chat')`),
    check("agent_tasks_role_ck", sql`${t.createdByRole} in ('owner','office','tech')`),
    // THE CLAIM'S INDEX. Its predicate and its column must match the claim query exactly or
    // the runner sequential-scans a growing table every tick.
    index("agent_tasks_due_idx")
      .on(t.nextActionAt)
      .where(sql`${t.status} = 'working' and ${t.deletedAt} is null`),
    // The board reads one org's tasks by status.
    index("agent_tasks_org_status_idx").on(t.orgId, t.status, t.updatedAt),
    unique("agent_tasks_org_id_uq").on(t.orgId, t.id),
  ],
);

/**
 * The conversation, append-only. One row per AgentMessage, in `seq` order.
 *
 * `blocks` holds the message verbatim, including `thinking` / `redacted_thinking` blocks, which
 * MUST round-trip byte-identical (signature and data included) or the provider rejects the next
 * request. Never rewrite a row; never drop a tool_use without its matching tool_result.
 */
export const agentTaskMessages = pgTable(
  "agent_task_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    // Strict intra-transaction order. created_at is transaction_timestamp() and is CONSTANT
    // within a tx, so it cannot order two messages written by one wake.
    seq: bigserial("seq", { mode: "number" }).notNull(),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    blocks: jsonb("blocks").$type<Readonly<Record<string, JsonValue>>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "agent_task_messages_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [agentTasks.orgId, agentTasks.id],
    }),
    check("agent_task_messages_role_ck", sql`${t.role} in ('user','assistant')`),
    check(
      "agent_task_messages_kind_ck",
      sql`${t.kind} in ('text','tool_results','user_blocks','assistant')`,
    ),
    index("agent_task_messages_task_seq_idx").on(t.orgId, t.taskId, t.seq),
  ],
);

/**
 * The execution ledger — the guard against a replayed side effect.
 *
 * A tool's business write and its ledger row commit in ONE transaction. If the process dies
 * after that commit but before the transcript row lands, the next wake sees a transcript ending
 * in an unanswered tool_use and would otherwise execute the tool a second time: two payments,
 * two texts, one customer. On replay the ledger's unique constraint says "already done" and the
 * stored summary is replayed as the tool result instead.
 */
export const agentToolExecutions = pgTable(
  "agent_tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    // The provider's tool_use id — stable across a replay of the same turn.
    toolUseId: text("tool_use_id").notNull(),
    tool: text("tool").notNull(),
    ok: text("ok").notNull(),
    // The rendered tool result, replayed verbatim so the model sees what it saw before.
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "agent_tool_executions_org_task_fk",
      columns: [t.orgId, t.taskId],
      foreignColumns: [agentTasks.orgId, agentTasks.id],
    }),
    check("agent_tool_executions_ok_ck", sql`${t.ok} in ('ok','error')`),
    unique("agent_tool_executions_org_use_uq").on(t.orgId, t.toolUseId),
  ],
);
