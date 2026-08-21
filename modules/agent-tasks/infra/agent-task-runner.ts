import { and, eq } from "drizzle-orm";
import { users } from "@mallet/shared/db/schema";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import { OutboxEventBus, safeLastError } from "@mallet/shared/outbox";
import type { IdGenerator } from "@mallet/shared/ports";
import {
  asAgentTaskId, asOrgId, asUserId, ok,
  type AgentTaskId, type Clock, type OrgId, type Result, type UserId, type ValidationError,
} from "@mallet/shared/types";
import {
  buildAgentTools, buildExecuteTool, LlmError, runAgentTurn, toolsForRole,
  type AgentMessage, type AgentResult, type AgentTool, type ExecuteTool, type LlmClient,
  type ToolDeps, type ToolMeta,
} from "@mallet/ai";
import { isRole, type Principal, type Role } from "@mallet/identity";
import type { AgentTask } from "../domain/agent-task";
import { decideWake, type WakeDecision } from "../domain/wake-decision";
import {
  LEASE_MINUTES, MAX_ITERS_PER_WAKE, MIN_STEP_MINUTES, WAKE_BATCH,
} from "../app/agent-task-config";
import { claimDueTasks } from "./claim-due-tasks";
import { DrizzleAgentTaskRepository } from "./drizzle-agent-task-repository";
import { buildTaskControlTools } from "./task-control-tools";

/**
 * modules/agent-tasks/infra/agent-task-runner.ts
 * One bounded tick of the AI employee: claim due tasks across tenants, re-enter each org's RLS,
 * drive the agent loop, write the outcome back under the lease.
 *
 * I/O orchestration only — every judgement it applies lives in `decideWake`, which the unit suite
 * owns (CI does not run integration tests). This file is in `coverage.exclude` for that reason and
 * is proven by `agent-task-runner.int.test.ts` against a live database.
 *
 * THE THREE PROPERTIES THAT MAKE THIS SAFE TO RUN UNATTENDED:
 *
 * 1. It acts as a REAL user, never a sentinel. `write-tools.ts` stamps `ctx.principal.userId` into
 *    `payments.recorded_by_user_id`, a write-once column with no FK (deliberate: the ledger has to
 *    survive a staffer leaving). A sentinel id would not fail loudly, it would quietly put a fake
 *    actor on the money. The principal is built from the creator's `users` row, re-read inside the
 *    tenant transaction on every wake — and if that person is gone, or their role no longer matches
 *    the snapshot the task was filed with, the task goes to a human instead of running with the
 *    wrong powers.
 * 2. Every write is fenced. The claim stamps `lease_id`; `save` is guarded on the version READ FROM
 *    THE DATABASE and `releaseLease` on that same `lease_id`, so a worker whose lease expired
 *    mid-turn cannot clobber its successor.
 * 3. A committed side effect is never repeated. The tool executor carries the execution ledger, so a
 *    wake killed between a tool's commit and its transcript write replays the stored result instead
 *    of re-sending or re-charging.
 */

export interface TickSummary {
  claimed: number;
  scheduled: number;
  finished: number;
  handedOver: number;
  backedOff: number;
  failed: number;
  raced: number;
  tookMs: number;
}

export interface TickDeps {
  readonly llm: LlmClient;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly notificationSender: ToolDeps["notificationSender"];
  readonly paymentLinkGateway: ToolDeps["paymentLinkGateway"];
  readonly systemPrompt: string;
  readonly batch?: number;
}

/** What one wake settled on. The keys are `TickSummary` counters, so a disposition tallies itself. */
type Disposition = "scheduled" | "finished" | "handedOver" | "backedOff" | "raced";

/** Everything a wake needs to address its own row. Never another task's. */
interface WakeRef {
  readonly orgId: OrgId;
  readonly taskId: AgentTaskId;
  readonly leaseId: string;
  readonly deps: TickDeps;
}

type WakePlan =
  | { readonly kind: "gone" }
  | { readonly kind: "hand_over"; readonly task: AgentTask; readonly note: string }
  | {
      readonly kind: "ready";
      readonly task: AgentTask;
      readonly principal: Principal;
      readonly messages: readonly AgentMessage[];
      readonly seededBytes: number;
    };

const HAND_OVER_CREATOR_GONE = "The person who set this up is no longer on the team, so I stopped.";
const HAND_OVER_ROLE_CHANGED =
  "The person who set this up has a different role now, so I stopped. Re-file it if it still needs doing.";
const BACK_OFF_NOTE = "retrying — the assistant was briefly unavailable";

/**
 * The dated line every wake starts with. Persisted as a real user message BEFORE the transcript is
 * read, never passed as `contextPreamble`: `runAgentTurn` applies a preamble only when the
 * transcript is empty, so it is dropped on exactly the resumed wakes that need it — and a task
 * picked up three days later would otherwise reason from the day it was filed and tell a customer
 * the wrong date.
 */
const dateLine = (now: Date): AgentMessage => ({
  role: "user",
  kind: "text",
  text:
    `[system] It is now ${now.toISOString()}. You are working a task in the background — the shop ` +
    `is not watching this conversation. Before you stop, call schedule_next_step or finish_task.`,
});

const sizeOf = (message: AgentMessage): number => JSON.stringify(message).length;

const nameOf = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

const repoOf = (tx: TenantTx, ref: WakeRef): DrizzleAgentTaskRepository =>
  new DrizzleAgentTaskRepository(tx, ref.orgId);

const metaOf = (tools: readonly AgentTool[]): ToolMeta[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    mutating: t.mutating,
  }));

/**
 * A transcript whose last message is an assistant turn with an unanswered tool_use. The loop
 * resolves that shape itself (that IS the resume path the execution ledger exists for), and a user
 * message appended after it would leave a dangling tool_use the provider rejects with a 400 — so
 * the date line is skipped on exactly those wakes.
 */
const awaitsToolResults = (messages: readonly AgentMessage[]): boolean => {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && last.blocks.some((b) => b.type === "tool_use");
};

/**
 * The creator as they are RIGHT NOW, inside the tenant transaction. Returns null when the row is
 * gone. A `role` outside the union is also null — fail closed rather than coerce to a default,
 * which would be a silent downgrade (the table's own check constraint makes it unreachable).
 */
const readCreator = async (
  tx: TenantTx,
  orgId: OrgId,
  createdBy: UserId,
): Promise<{ readonly userId: UserId; readonly role: Role } | null> => {
  const rows = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.id, createdBy)))
    .limit(1);
  const row = rows[0];
  if (!row || !isRole(row.role)) return null;
  return { userId: asUserId(row.id), role: row.role };
};

/** The read phase: one short tenant transaction that decides whether this wake may run at all. */
const planWake = async (ref: WakeRef, line: AgentMessage): Promise<WakePlan> =>
  withTenant(ref.orgId, async (tx): Promise<WakePlan> => {
    const repo = repoOf(tx, ref);
    const task = await repo.findById(ref.taskId);
    if (!task) {
      // Soft-deleted between the claim and this read. Release anyway: releaseLease deliberately
      // does not filter deletedAt, and a lease nothing can clear is a lease nothing cleans up.
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return { kind: "gone" };
    }
    const creator = await readCreator(tx, ref.orgId, task.props.createdBy);
    if (!creator) return { kind: "hand_over", task, note: HAND_OVER_CREATOR_GONE };
    if (creator.role !== task.props.createdByRole) {
      return { kind: "hand_over", task, note: HAND_OVER_ROLE_CHANGED };
    }

    const principal: Principal = { userId: creator.userId, orgId: ref.orgId, role: creator.role };
    const existing = await repo.loadMessages(ref.taskId);
    if (awaitsToolResults(existing)) {
      return { kind: "ready", task, principal, messages: existing, seededBytes: 0 };
    }
    await repo.appendMessage(ref.taskId, line);
    return { kind: "ready", task, principal, messages: [...existing, line], seededBytes: sizeOf(line) };
  });

/** The catalog executor: least privilege, untrusted-data markers on, replay ledger wired. */
const buildCatalogExecutor = (
  ref: WakeRef,
  principal: Principal,
  catalog: readonly AgentTool[],
): ExecuteTool =>
  buildExecuteTool({
    tools: catalog,
    // The first and only caller that turns the markers on: this is the one driver with no human
    // reading the tool results, so record data must be fenced off from instructions.
    delimitResults: true,
    ledger: {
      find: (toolUseId) => withTenant(ref.orgId, (tx) => repoOf(tx, ref).findExecution(toolUseId)),
      // The ledger row rides the tool's OWN transaction, so "it happened" and "we know it
      // happened" cannot land on opposite sides of a commit.
      record: (tx, execution) => repoOf(tx, ref).recordExecution(ref.taskId, execution),
    },
    runInTenant: (fn) =>
      withTenant(ref.orgId, (tx) =>
        fn({
          tx,
          orgId: ref.orgId,
          principal,
          deps: {
            bus: new OutboxEventBus(tx, ref.orgId),
            clock: ref.deps.clock,
            ids: ref.deps.ids,
            notificationSender: ref.deps.notificationSender,
            paymentLinkGateway: ref.deps.paymentLinkGateway,
          },
        }),
      ),
  });

const wakeOne = async (ref: WakeRef): Promise<Disposition> => {
  const plan = await planWake(ref, dateLine(ref.deps.clock.now()));
  if (plan.kind === "gone") return "raced";
  if (plan.kind === "hand_over") {
    return settle(ref, plan.task, plan.task.props.transcriptBytes, {
      kind: "hand_over",
      note: plan.note,
    });
  }

  const { task, principal, messages } = plan;
  const control = buildTaskControlTools(ref.taskId, { now: () => ref.deps.clock.now() });
  const catalog = toolsForRole(buildAgentTools(), principal.role);
  const runCatalogTool = buildCatalogExecutor(ref, principal, catalog);
  // The tool_use id comes from the loop's third argument, never from a closure: one assistant turn
  // can emit two tool_use blocks, and a tracked "last id" would key the ledger on the wrong call.
  const execute: ExecuteTool = (name, input, toolUseId) =>
    control.meta.some((m) => m.name === name)
      ? control.handle(name, input)
      : runCatalogTool(name, input, toolUseId);

  let bytes = task.props.transcriptBytes + plan.seededBytes;
  // onProgress is fail-fast by design: if this rejects, the whole turn rejects and the tick records
  // a real failure. That is correct — a transcript we could not persist is a transcript the next
  // wake would re-derive from a tool call it already ran.
  const persist = async (message: AgentMessage): Promise<void> => {
    bytes += sizeOf(message);
    await withTenant(ref.orgId, (tx) => repoOf(tx, ref).appendMessage(ref.taskId, message));
  };

  let result: AgentResult;
  try {
    result = await runAgentTurn({
      llm: ref.deps.llm,
      system: ref.deps.systemPrompt,
      tools: [...metaOf(catalog), ...control.meta],
      execute,
      priorMessages: messages,
      maxIters: MAX_ITERS_PER_WAKE,
      effort: "medium",
      onProgress: persist,
    });
  } catch (error: unknown) {
    // A provider blip must not spend a budget: every task in a rate-limited org would otherwise
    // burn one in the same tick. A NON-retryable LlmError is a real failure and falls through.
    if (error instanceof LlmError && error.retryable) return backOff(ref, task);
    throw error;
  }

  const decision = decideWake({
    result,
    control: control.outcome(),
    stepsTaken: task.props.stepsTaken,
    transcriptBytes: bytes,
    now: ref.deps.clock.now(),
  });
  return settle(ref, task, bytes, decision);
};

const applyTo = (
  task: AgentTask,
  decision: WakeDecision,
  now: Date,
): Result<AgentTask, ValidationError> =>
  decision.kind === "schedule"
    ? task.scheduleNext(decision.at, decision.note, now)
    : decision.kind === "finish"
      ? task.finish(decision.summary, now)
      : ok(task.needsYou(decision.note, now));

const dispositionOf = (decision: WakeDecision): Disposition =>
  decision.kind === "schedule" ? "scheduled" : decision.kind === "finish" ? "finished" : "handedOver";

/**
 * The write phase: the task row is written exactly ONCE per wake, then the lease is released.
 *
 * `read` is the task as it was when this wake started. A different version in the row now means a
 * human replied (or a repair script ran) while the turn was thinking: their write wins and this
 * turn's disposition is discarded. The transcript rows this wake already committed stay — they are
 * what the human's own resume reads.
 */
const settle = async (
  ref: WakeRef,
  read: AgentTask,
  bytes: number,
  decision: WakeDecision,
): Promise<Disposition> => {
  const now = ref.deps.clock.now();
  const written = await withTenant(ref.orgId, async (tx) => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    if (!current || current.props.version !== read.props.version) {
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return false;
    }
    const settled = applyTo(current, decision, now);
    if (!settled.ok) {
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return false;
    }
    // expectedVersion is ALWAYS the version READ FROM THE DATABASE, never the in-memory
    // aggregate's. Both transitions below have already incremented it while the row still holds
    // `current.props.version`; guarding on the composed value matches zero rows, so `save` would
    // return false forever and every wake would report "raced" while persisting nothing.
    const saved = await repo.save(settled.value.withTranscriptBytes(bytes, now), current.props.version);
    // Released whatever the save decided: a lease we keep past our turn only delays the next one.
    await repo.releaseLease(ref.taskId, ref.leaseId);
    return saved;
  });
  if (!written) return "raced";
  logger.info({ orgId: ref.orgId, taskId: ref.taskId, decision: decision.kind }, "agent.task.wake.settled");
  return dispositionOf(decision);
};

/** A retryable provider failure: come back soon, spending neither the attempt nor the step budget. */
const backOff = async (ref: WakeRef, read: AgentTask): Promise<Disposition> => {
  const now = ref.deps.clock.now();
  await withTenant(ref.orgId, async (tx) => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    if (current && current.props.version === read.props.version) {
      const later = new Date(now.getTime() + MIN_STEP_MINUTES * 60_000);
      const next = current.deferTo(later, BACK_OFF_NOTE, now);
      // expectedVersion is ALWAYS the version READ FROM THE DATABASE — see settle().
      if (next.ok) await repo.save(next.value, current.props.version);
    }
    await repo.releaseLease(ref.taskId, ref.leaseId);
  });
  logger.warn({ orgId: ref.orgId, taskId: ref.taskId }, "agent.task.wake.backed-off");
  return "backedOff";
};

/**
 * A real failure. `lastError` is a low-cardinality discriminator from `safeLastError` and nothing
 * else — never transcript content, note text or model output. The task keeps its place (and its
 * due time) until the attempt budget is spent, then the aggregate hands it to a human.
 */
const recordFailure = async (ref: WakeRef, lastError: string): Promise<void> => {
  const now = ref.deps.clock.now();
  await withTenant(ref.orgId, async (tx) => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    if (!current) return;
    // expectedVersion is ALWAYS the version READ FROM THE DATABASE — see settle().
    await repo.save(current.recordFailure(lastError, now), current.props.version);
    await repo.releaseLease(ref.taskId, ref.leaseId);
  });
};

export const runAgentTaskTick = async (deps: TickDeps): Promise<TickSummary> => {
  const startedAt = Date.now();
  const leaseId = deps.ids.newId();

  const claimed = await claimDueTasks({
    batch: deps.batch ?? WAKE_BATCH,
    leaseMinutes: LEASE_MINUTES,
    leaseId,
    now: deps.clock.now(),
  });

  const summary: TickSummary = {
    claimed: claimed.length,
    scheduled: 0,
    finished: 0,
    handedOver: 0,
    backedOff: 0,
    failed: 0,
    raced: 0,
    tookMs: 0,
  };

  // SEQUENTIAL, never Promise.all: the app pool is max 10 and the request path shares it. The
  // outbox relay dispatches sequentially for exactly this reason.
  for (const row of claimed) {
    const ref: WakeRef = { orgId: asOrgId(row.orgId), taskId: asAgentTaskId(row.id), leaseId, deps };
    try {
      const disposition = await wakeOne(ref);
      summary[disposition] += 1;
    } catch (error: unknown) {
      // One bad task must never strand the rest of the batch. `name`, never `message`: a driver or
      // Postgres error message can carry row values, and no task content belongs in a log line.
      summary.failed += 1;
      logger.error({ orgId: ref.orgId, taskId: ref.taskId, err: nameOf(error) }, "agent.task.wake.threw");
      await recordFailure(ref, safeLastError({ kind: "threw" })).catch((writeError: unknown) => {
        // The row is untouched, so the lease expires and the next tick re-claims it. Never silent.
        logger.error(
          { orgId: ref.orgId, taskId: ref.taskId, err: nameOf(writeError) },
          "agent.task.failure.write-failed",
        );
      });
    }
  }

  summary.tookMs = Date.now() - startedAt;
  logger.info({ ...summary }, "agent.tick.completed");
  return summary;
};
