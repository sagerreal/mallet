import { and, eq } from "drizzle-orm";
import { orgs, orgSettings, users } from "@mallet/shared/db/schema";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import { OutboxEventBus, safeLastError } from "@mallet/shared/outbox";
import type { IdGenerator } from "@mallet/shared/ports";
import {
  asAgentTaskId, asOrgId, asUserId,
  type AgentTaskId, type Clock, type OrgId, type UserId,
} from "@mallet/shared/types";
import {
  buildAgentTools, buildExecuteTool, runAgentTurn, toolsForRole,
  type AgentMessage, type AgentResult, type AgentTool, type ExecuteTool, type LlmClient,
  type ToolDeps, type ToolMeta,
} from "@mallet/ai";
import { isRole, type Principal, type Role } from "@mallet/identity";
import type { AgentTask } from "../domain/agent-task";
import { decideWake, type WakeDecision } from "../domain/wake-decision";
import { awaitsToolResults, dateLine, DEFAULT_TIMEZONE, type WakeOrgContext } from "../domain/wake-context";
import {
  applyDecision, classifyTurnFailure, dispositionOf, TickBudgetExceeded, TICK_BUDGET_ERROR,
  type WakeDisposition,
} from "../domain/wake-outcome";
import {
  LEASE_MINUTES, MAX_ITERS_PER_WAKE, MIN_STEP_MINUTES, TICK_BUDGET_MS, WAKE_BATCH,
} from "../app/agent-task-config";
import { claimDueTasks } from "./claim-due-tasks";
import { DrizzleAgentTaskRepository } from "./drizzle-agent-task-repository";
import { buildTaskControlTools } from "./task-control-tools";

/**
 * modules/agent-tasks/infra/agent-task-runner.ts
 * One bounded tick of the AI employee: claim due tasks across tenants, re-enter each org's RLS,
 * drive the agent loop, write the outcome back under the lease.
 *
 * I/O orchestration ONLY. Every branch that is a judgement lives in domain/ under the unit suite —
 * `decideWake` (what a turn meant), `applyDecision`/`dispositionOf` (which transition that is),
 * `classifyTurnFailure` (blip vs deadline vs real failure), `awaitsToolResults` (whether a message
 * may be appended at all) and `dateLine` (what day the agent believes it is). That is what earns
 * this file its place in `coverage.exclude`; it is proven end-to-end by `agent-task-runner.int.test.ts`.
 *
 * THE FOUR PROPERTIES THAT MAKE THIS SAFE TO RUN UNATTENDED:
 *
 * 1. It acts as a REAL user, never a sentinel. `write-tools.ts` stamps `ctx.principal.userId` into
 *    `payments.recorded_by_user_id`, a write-once column with no FK (deliberate: the ledger has to
 *    survive a staffer leaving). A sentinel id would not fail loudly, it would quietly put a fake
 *    actor on the money. The principal is built from the creator's `users` row, re-read inside the
 *    tenant transaction on every wake — and if that person is gone, or their role no longer matches
 *    the snapshot the task was filed with, the task goes to a human instead of running with the
 *    wrong powers.
 * 2. Every write is DOUBLY fenced: on the version READ FROM THE DATABASE, and on the `lease_id`
 *    this worker was granted at claim. A worker that lost its lease mid-turn physically cannot
 *    write, so it can neither clobber its successor nor settle a row somebody else now owns.
 * 3. It stops itself before its own lease window closes (`TICK_BUDGET_MS`), rather than letting the
 *    platform kill it. A killed tick leaves no trail; a self-stopped one records both the tail it
 *    never started and the turn it abandoned.
 * 4. A committed side effect is never repeated. The tool executor carries the execution ledger, so a
 *    wake killed between a tool's commit and its transcript write replays the stored result instead
 *    of re-sending or re-charging.
 */

export interface TickSummary {
  claimed: number;
  scheduled: number;
  finished: number;
  handedOver: number;
  backedOff: number;
  /** Started, then stopped mid-turn at the tick's wall-clock deadline. An attempt WAS spent. */
  abandoned: number;
  /** Claimed but never started: the budget ran out first. The lease is released, the row untouched. */
  skipped: number;
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
  /** Wall-clock budget for the whole tick. Injected so a test can prove the deadline path. */
  readonly budgetMs?: number;
}

/** Everything a wake needs to address its own row. Never another task's. */
interface WakeRef {
  readonly orgId: OrgId;
  readonly taskId: AgentTaskId;
  readonly leaseId: string;
  readonly deps: TickDeps;
  /** `Date.now()` past which this wake must stop working and settle what it has. */
  readonly deadlineAt: number;
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
 * The row is still ours to write: same version we read AND still our lease.
 *
 * The lease half is not redundant. The version guard alone lets a worker whose lease expired
 * mid-turn settle a row that a later tick has since reclaimed and may be actively working — the
 * version would still match if that tick has not written yet. `findById` already returns `leaseId`,
 * so the check costs nothing.
 */
const stillOurs = (current: AgentTask, read: AgentTask, ref: WakeRef): boolean =>
  current.props.version === read.props.version && current.props.leaseId === ref.leaseId;

/** The shop's name and timezone, for the dated line. Same two reads as ai-router's orgPreamble. */
const readOrgContext = async (tx: TenantTx, orgId: OrgId): Promise<WakeOrgContext> => {
  const [org] = await tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  const [settings] = await tx
    .select({ timezone: orgSettings.timezone })
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId))
    .limit(1);
  return { name: org?.name ?? null, timezone: settings?.timezone ?? DEFAULT_TIMEZONE };
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
const planWake = async (ref: WakeRef): Promise<WakePlan> =>
  withTenant(ref.orgId, async (tx): Promise<WakePlan> => {
    const repo = repoOf(tx, ref);
    const task = await repo.findById(ref.taskId);
    if (!task) {
      // Soft-deleted between the claim and this read. Release anyway: releaseLease deliberately
      // does not filter deletedAt, and a lease nothing can clear is a lease nothing cleans up.
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return { kind: "gone" };
    }
    // Somebody reclaimed this row between the claim and now, so it is not ours to work.
    if (task.props.leaseId !== ref.leaseId) return { kind: "gone" };

    const creator = await readCreator(tx, ref.orgId, task.props.createdBy);
    if (!creator) return { kind: "hand_over", task, note: HAND_OVER_CREATOR_GONE };
    if (creator.role !== task.props.createdByRole) {
      return { kind: "hand_over", task, note: HAND_OVER_ROLE_CHANGED };
    }

    const principal: Principal = { userId: creator.userId, orgId: ref.orgId, role: creator.role };
    const existing = await repo.loadMessages(ref.taskId);
    // A transcript still owed tool results is resumed AS IS — see awaitsToolResults for why a
    // message appended here would 400 the provider on every wake.
    if (awaitsToolResults(existing)) {
      return { kind: "ready", task, principal, messages: existing, seededBytes: 0 };
    }
    const line = dateLine(ref.deps.clock.now(), await readOrgContext(tx, ref.orgId));
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

const wakeOne = async (ref: WakeRef): Promise<WakeDisposition> => {
  const plan = await planWake(ref);
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
  // onProgress is fail-fast by design: runAgentTurn awaits it without catching, so this is also the
  // tick's deadline hook — a message boundary is the only point at which the stored transcript is
  // consistent enough to abandon the turn. If the append itself fails, the turn rejects too, which
  // is correct: a transcript we could not persist is one the next wake would re-derive from a tool
  // call it already ran.
  const persist = async (message: AgentMessage): Promise<void> => {
    bytes += sizeOf(message);
    await withTenant(ref.orgId, (tx) => repoOf(tx, ref).appendMessage(ref.taskId, message));
    if (Date.now() > ref.deadlineAt) throw new TickBudgetExceeded();
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
    const kind = classifyTurnFailure(error);
    // A provider blip must not spend a budget: every task in a rate-limited org would otherwise
    // burn one in the same tick. Our own deadline DOES spend one, so a task that reliably outlives
    // the function retires to a human instead of retrying forever at full LLM cost.
    if (kind === "back_off") return backOff(ref, task);
    if (kind === "abandon") {
      logger.warn({ orgId: ref.orgId, taskId: ref.taskId }, "agent.task.wake.abandoned");
      await recordFailure(ref, TICK_BUDGET_ERROR);
      return "abandoned";
    }
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

/**
 * The write phase: the task row is written exactly ONCE per wake, then the lease is released.
 *
 * `read` is the task as it was when this wake started. A different version, or a lease that is no
 * longer ours, means somebody else owns this row now: their write wins and this turn's disposition
 * is discarded. The transcript rows this wake already committed stay — they are what the human's
 * own resume reads.
 */
const settle = async (
  ref: WakeRef,
  read: AgentTask,
  bytes: number,
  decision: WakeDecision,
): Promise<WakeDisposition> => {
  const now = ref.deps.clock.now();
  const outcome = await withTenant(ref.orgId, async (tx): Promise<WakeDisposition> => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    if (!current || !stillOurs(current, read, ref)) {
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return "raced";
    }
    const settled = applyDecision(current, decision, now);
    // expectedVersion is ALWAYS the version READ FROM THE DATABASE, never the in-memory
    // aggregate's. Both transitions below have already incremented it while the row still holds
    // `current.props.version`; guarding on the composed value matches zero rows, so `save` would
    // return false forever and every wake would report "raced" while persisting nothing.
    if (!settled.ok) {
      // The aggregate refused the transition. Recording a failure (rather than reporting "raced")
      // is what stops this becoming a full paid LLM turn every tick forever: "raced" left
      // next_action_at untouched and no trail at all.
      logger.error(
        { orgId: ref.orgId, taskId: ref.taskId, decision: decision.kind },
        "agent.task.wake.transition-refused",
      );
      await repo.save(
        current.recordFailure(safeLastError({ kind: "apperror", error: settled.error }), now),
        current.props.version,
      );
      await repo.releaseLease(ref.taskId, ref.leaseId);
      return "failed";
    }
    const saved = await repo.save(settled.value.withTranscriptBytes(bytes, now), current.props.version);
    // Released whatever the save decided: a lease we keep past our turn only delays the next one.
    await repo.releaseLease(ref.taskId, ref.leaseId);
    return saved ? dispositionOf(decision) : "raced";
  });
  if (outcome !== "raced" && outcome !== "failed") {
    logger.info({ orgId: ref.orgId, taskId: ref.taskId, decision: decision.kind }, "agent.task.wake.settled");
  }
  return outcome;
};

/** A retryable provider failure: come back soon, spending neither the attempt nor the step budget. */
const backOff = async (ref: WakeRef, read: AgentTask): Promise<WakeDisposition> => {
  const now = ref.deps.clock.now();
  await withTenant(ref.orgId, async (tx) => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    if (current && stillOurs(current, read, ref)) {
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
 * A real failure. `lastError` is a low-cardinality discriminator and nothing else — never
 * transcript content, note text or model output. The task keeps its place (and its due time) until
 * the attempt budget is spent, then the aggregate hands it to a human.
 */
const recordFailure = async (ref: WakeRef, lastError: string): Promise<void> => {
  const now = ref.deps.clock.now();
  await withTenant(ref.orgId, async (tx) => {
    const repo = repoOf(tx, ref);
    const current = await repo.findById(ref.taskId);
    // Only ours to write. Not skipped when the row is gone: the lease is still released, exactly as
    // planWake does — a lease this path could not clear is one nothing else will ever clean up.
    if (current && current.props.leaseId === ref.leaseId) {
      // expectedVersion is ALWAYS the version READ FROM THE DATABASE — see settle().
      await repo.save(current.recordFailure(lastError, now), current.props.version);
    }
    await repo.releaseLease(ref.taskId, ref.leaseId);
  });
};

/** Claimed but never started. Untouched, so the lease goes back and the next tick takes it first. */
const releaseUnstarted = async (ref: WakeRef): Promise<void> => {
  await withTenant(ref.orgId, (tx) => repoOf(tx, ref).releaseLease(ref.taskId, ref.leaseId));
};

export const runAgentTaskTick = async (deps: TickDeps): Promise<TickSummary> => {
  const startedAt = Date.now();
  const deadlineAt = startedAt + (deps.budgetMs ?? TICK_BUDGET_MS);
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
    abandoned: 0,
    skipped: 0,
    failed: 0,
    raced: 0,
    tookMs: 0,
  };

  // SEQUENTIAL, never Promise.all: the app pool is max 10 and the request path shares it. The
  // outbox relay dispatches sequentially for exactly this reason.
  for (const row of claimed) {
    const ref: WakeRef = {
      orgId: asOrgId(row.orgId),
      taskId: asAgentTaskId(row.id),
      leaseId,
      deps,
      deadlineAt,
    };
    // Stop CLAIMING new work while there is still lease window left to write in. claimDueTasks
    // stamps one shared locked_until for the whole batch at tick start and never renews it, so the
    // later a wake starts the less fence it has left — and being killed by the platform instead
    // would leave this tail leased-but-unworked with no trail.
    if (Date.now() > deadlineAt) {
      summary.skipped += 1;
      await releaseUnstarted(ref).catch((error: unknown) => {
        logger.error({ orgId: ref.orgId, taskId: ref.taskId, err: nameOf(error) }, "agent.task.release-failed");
      });
      continue;
    }
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
