import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { withTenant } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { asAgentTaskId, ok, toPage } from "@mallet/shared/types";
import type { AgentTaskId, OrgId } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";
import {
  buildAgentTools, buildExecuteTool, describeProposal, runAgentTurn, toolsForRole, LlmError, SYSTEM_PROMPT,
  type AgentMessage, type AgentResult, type ExecuteTool, type ExecutionLedger, type PendingAction,
  type ToolDeps, type ToolMeta,
} from "@mallet/ai";
import { DrizzleAgentTaskRepository } from "../infra/drizzle-agent-task-repository";
import { CreateAgentTaskUseCase } from "../app/create-agent-task";
import type { AgentTask } from "../domain/agent-task";
import { awaitsToolResults } from "../domain/wake-context";
import { REPLY_LEASE_MS, TITLE_MAX } from "../app/agent-task-config";

/**
 * modules/agent-tasks/api/agent-task-router.ts
 * File, read, reply to and approve the AI employee's work — the surface that finally exercises
 * the execution ledger, because `reply`/`approve` (folded into one `reply` mutation, per the
 * drawer's two controls) is the first caller that can drive a mutating tool to completion; the
 * background runner never populates an approved-tool list on its own.
 */

const taskDTO = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(["working", "needs_you", "done", "closed"]),
  nextActionAt: z.string().nullable(),
  nextActionNote: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.string(),
  createdAt: z.string(),
});

const toTaskDTO = (t: AgentTask) => ({
  id: t.props.id,
  title: t.props.title,
  status: t.props.status,
  nextActionAt: t.props.nextActionAt?.toISOString() ?? null,
  nextActionNote: t.props.nextActionNote,
  version: t.props.version,
  updatedAt: t.props.updatedAt.toISOString(),
  createdAt: t.props.createdAt.toISOString(),
});

/** What the drawer renders as conversation: the human-readable turns. Tool traffic and the
 *  runner's dated `[system]` seed line are machinery, never conversation. */
const messageDTO = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

/** One action awaiting a human tap. `summary` is rendered server-side via `describeProposal` —
 *  never a de-underscored tool name, which tells a shop owner nothing about which invoice. */
const pendingDTO = z.object({
  toolUseId: z.string(),
  tool: z.string(),
  summary: z.string(),
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const argsOf = (input: unknown): Record<string, JsonValue> =>
  isRecord(input) ? (input as Record<string, JsonValue>) : {};

/**
 * Tool uses in the LAST assistant turn, when that turn is still unanswered (no `tool_results`
 * message has followed it yet). This is exactly `resolvePending`'s view of "awaiting" — the loop
 * pauses the WHOLE turn until every mutating call in it is approved or denied, so nothing past
 * this point in the transcript has executed.
 */
const pendingOf = (messages: readonly AgentMessage[]): PendingAction[] => {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return [];
  return last.blocks.flatMap((b) => (b.type === "tool_use" ? [{ toolUseId: b.id, tool: b.name, input: b.input }] : []));
};

/** Only the parts a person can read. Tool traffic and the runner's `[system]` seed line are
 *  machinery, not conversation. */
const readable = (m: AgentMessage): Array<{ role: "user" | "assistant"; text: string }> => {
  if (m.role === "user" && m.kind === "text" && !m.text.startsWith("[system]")) {
    return [{ role: "user", text: m.text }];
  }
  if (m.role === "assistant") {
    const text = m.blocks
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n")
      .trim();
    return text.length > 0 ? [{ role: "assistant", text }] : [];
  }
  return [];
};

const sizeOf = (message: AgentMessage): number => JSON.stringify(message).length;

const providerErrorOf = (error: unknown): TRPCError | null =>
  error instanceof LlmError
    ? new TRPCError({
        code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
        message: "the AI assistant is temporarily unavailable — please try again",
      })
    : null;

interface ReplyInput {
  readonly text?: string;
  readonly approvedIds: readonly string[];
  readonly deniedIds: readonly string[];
}

/**
 * The drawer's two controls (a reply box, and Approve/Deny on a pending proposal) are mutually
 * exclusive on a single turn — see the class doc on `reply` for why combining them would silently
 * bury the approval. Throws BAD_REQUEST rather than guessing which one the caller meant.
 */
const parseReplyInput = (input: {
  readonly text?: string;
  readonly approvedToolUseIds?: readonly string[];
  readonly deniedToolUseIds?: readonly string[];
}): ReplyInput => {
  const approvedIds = input.approvedToolUseIds ?? [];
  const deniedIds = input.deniedToolUseIds ?? [];
  const hasApprovalIds = approvedIds.length > 0 || deniedIds.length > 0;
  const text = input.text && input.text.length > 0 ? input.text : undefined;

  if (!text && !hasApprovalIds) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "say something, or approve/decline a pending action" });
  }
  if (text && hasApprovalIds) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "send a reply or an approval, not both" });
  }
  return { text, approvedIds, deniedIds };
};

/**
 * THE DANGLING-TOOL_USE GUARD, and the most consequential refusal on this surface.
 *
 * A transcript whose last message is an unanswered assistant `tool_use` is a RESUME: `runAgentTurn`
 * recognises exactly that shape and resolves it. Appending a user message first makes the tail a
 * user turn, the loop stops recognising the resume, and the provider is handed a `tool_use` with no
 * matching `tool_result` — which it rejects UNCONDITIONALLY, on this request and on every later one.
 * `providerErrorOf` then maps it to BAD_GATEWAY "temporarily unavailable", which is a lie: the row
 * is permanently unusable, and because the task sits in `needs_you` (next_action_at null) no wake
 * ever revisits it. The task is bricked, silently, by an owner typing "yes, go ahead" instead of
 * pressing Approve.
 *
 * `awaitsToolResults` is the same predicate the runner's own date-line skip uses
 * (domain/wake-context.ts), so the two writers cannot disagree about the shape.
 *
 * CONFLICT, not BAD_REQUEST: the request is well formed and was legal for the state the client
 * rendered — the client's view is simply behind the server's (or, since the fix, the drawer hides
 * the reply box entirely and this is defence-in-depth against a stale tab). CONFLICT is in
 * error-map.ts's PASS_THROUGH set, so this sentence reaches the person verbatim, and it is the code
 * the drawer already recovers from by reloading.
 */
const assertNotAwaitingDecision = (messages: readonly AgentMessage[]): void => {
  if (!awaitsToolResults(messages)) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: "Artie is waiting on your decision above — approve or decline first, then you can reply.",
  });
};

/**
 * The forged-approval guard, checked against the SERVER's own stored transcript — never a
 * client-supplied copy of it. Scoped to what is genuinely pending (the last, unanswered assistant
 * tool_use turn) rather than "ever appeared in this task's history", so a stale id from an
 * already-resolved turn is refused exactly like one that never existed.
 */
const assertIdsArePending = (
  messages: readonly AgentMessage[],
  approvedIds: readonly string[],
  deniedIds: readonly string[],
): void => {
  const pendingIds = new Set(pendingOf(messages).map((p) => p.toolUseId));
  const submitted = [...approvedIds, ...deniedIds];
  if (submitted.some((sid) => !pendingIds.has(sid))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "approved/denied id not found in this task's pending approval" });
  }
};

/** The one sentence for "somebody else wrote first" — CONFLICT, which passes through to the user. */
const assertVersion = (task: AgentTask, expectedVersion: number): void => {
  if (task.props.version === expectedVersion) return;
  throw new TRPCError({
    code: "CONFLICT",
    message: "the assistant replied while you were typing — reload to see it",
  });
};

/**
 * THE AUTHORITATIVE READ, taken INSIDE the lease, plus every guard that depends on it.
 *
 * Order matters, and this is why `reply` acquires the lease BEFORE these guards rather than after.
 * A transcript read before the lease can already be a round trip old: a concurrent approver who got
 * there first has appended its `tool_results`, so `pendingOf` would be empty and this caller would
 * be turned away with "approved/denied id not found in this task's pending approval" — a sentence
 * that reads like a bug to the second office user on the shared "Needs you" queue, when the truth
 * is simply "someone else is doing it". Holding the lease first makes the state we validate against
 * and the state we then act on the same state.
 */
const loadForReply = async (
  orgId: OrgId,
  id: AgentTaskId,
  expectedVersion: number,
  reply: ReplyInput,
): Promise<{ task: AgentTask; messages: readonly AgentMessage[] }> => {
  const loaded = await withTenant(orgId, async (tx) => {
    const repo = new DrizzleAgentTaskRepository(tx, orgId);
    const task = await repo.findById(id);
    if (!task) return null;
    return { task, messages: await repo.loadMessages(id) };
  });
  if (!loaded) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
  // Re-checked under the lease: the row can have moved on between the preflight and the acquire.
  assertVersion(loaded.task, expectedVersion);
  // A prose reply on top of an unanswered tool_use permanently bricks the task — see
  // `assertNotAwaitingDecision`. Both guards run before the model is ever called.
  if (reply.text) assertNotAwaitingDecision(loaded.messages);
  if (reply.approvedIds.length > 0 || reply.deniedIds.length > 0) {
    assertIdsArePending(loaded.messages, reply.approvedIds, reply.deniedIds);
  }
  return loaded;
};

export const createAgentTaskRouter = () =>
  router({
    list: ownerOrOffice
      .input(
        z.object({
          status: z.enum(["working", "needs_you", "done", "closed"]).optional(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
      )
      .output(z.object({ items: z.array(taskDTO), nextCursor: z.string().nullable() }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleAgentTaskRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.list(toPage({ limit: input.limit ?? 25, cursor: null }), {
          status: input.status,
        });
        return { items: page.items.map(toTaskDTO), nextCursor: page.nextCursor };
      }),

    get: ownerOrOffice
      .input(z.object({ taskId: z.string().uuid() }))
      .output(z.object({ task: taskDTO, messages: z.array(messageDTO), pending: z.array(pendingDTO) }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleAgentTaskRepository(ctx.tx, ctx.principal.orgId);
        const id = asAgentTaskId(input.taskId);
        const task = await repo.findById(id);
        // Row-level absence, not a permission error: another org's id simply does not exist here.
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
        const messages = await repo.loadMessages(id);
        return {
          task: toTaskDTO(task),
          messages: messages.flatMap(readable),
          pending: pendingOf(messages).map((p) => ({
            toolUseId: p.toolUseId,
            tool: p.tool,
            summary: describeProposal(p.tool, argsOf(p.input)),
          })),
        };
      }),

    create: ownerOrOffice
      .input(z.object({ title: z.string().trim().min(1).max(TITLE_MAX), instruction: z.string().trim().min(1).max(4000) }))
      .output(taskDTO)
      .mutation(async ({ ctx, input }) => {
        const uc = new CreateAgentTaskUseCase(
          new DrizzleAgentTaskRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toTaskDTO(
          orThrow(
            await uc.exec({
              title: input.title,
              instruction: input.instruction,
              createdBy: ctx.principal.userId,
              createdByRole: ctx.principal.role,
            }),
          ),
        );
      }),

    close: ownerOrOffice
      .input(z.object({ taskId: z.string().uuid(), version: z.number().int() }))
      .output(taskDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleAgentTaskRepository(ctx.tx, ctx.principal.orgId);
        const now = ctx.deps.clock.now();
        const task = await repo.findById(asAgentTaskId(input.taskId));
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
        /**
         * THE LEASE GATE, in the same shape `reply` presents to a person: while Artie is genuinely
         * mid-wake, a human write on the row loses loudly rather than racing it.
         *
         * CHECKED, not ACQUIRED — deliberately, and this is the one place the two procedures differ
         * in mechanism rather than in behaviour. `reply` must ACQUIRE because it holds the row
         * across an LLM round trip and can drive a mutating tool, so two concurrent replies would
         * both execute; `close` is one version-guarded UPDATE inside one transaction, and Postgres
         * already serializes that — two concurrent closes cannot both win, so there is nothing a
         * lease would add except a window in which this request could die holding it.
         */
        if (task.isLeaseLive(now)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Artie is working on this right now — give it a moment and reload.",
          });
        }
        const closed = orThrow(task.close(now));
        // THE VERSION RULE: expectedVersion is the version just READ from the database above —
        // never `task.props.version` after a transition (the aggregate already incremented that
        // one in memory, and it matches no row).
        const saved = await repo.save(closed, task.props.version);
        if (!saved) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "the assistant changed this task while you were looking — reload to see it",
          });
        }
        return toTaskDTO(closed);
      }),

    /**
     * A human replies, or approves/denies what the agent proposed — one mutation, because the
     * drawer's two controls (a reply box, and Approve/Deny on a pending proposal) are mutually
     * exclusive on a single turn: `runAgentTurn` only resolves a pending tool_use when the
     * transcript's LAST message is that unanswered assistant turn, and supplying `text` appends a
     * new user message first, burying it. So a caller sends text OR approval ids, never both.
     *
     * NoTx: the loop opens its own short transaction per tool call (`buildExecuteTool`'s
     * `runInTenant`) — a request-long transaction here would pin a pool slot across an LLM
     * round trip, exactly like `v1.ai.run`/`resume`.
     *
     * The client never sends a transcript. It sends `{ taskId, version, text? }` plus optional
     * approval ids; the server owns the conversation and appends to it. That is what makes a
     * forged tool_result impossible here, which it is not on `v1.ai.run` (whose `transcriptSchema`
     * accepts client-supplied `tool_results` and trusts them).
     *
     * THE ORDER, all of it BEFORE the model is ever called:
     *  1. `parseReplyInput` — text XOR approval ids (BAD_REQUEST), never both.
     *  2. a preflight version check — a stale client loses loudly (CONFLICT) without taking a lease.
     *  3. the lease is ACQUIRED for the duration of the turn (CONFLICT if someone else holds it).
     *  4. the transcript is re-read UNDER the lease, and the version re-checked against it.
     *  5. `assertNotAwaitingDecision` — prose on top of an unanswered `tool_use` permanently bricks
     *     the task, so it is refused (CONFLICT) rather than persisted.
     *  6. `assertIdsArePending` — a forged/stale approval id (BAD_REQUEST).
     * The lease sits ahead of 4-6 on purpose: guards run against the state the turn then acts on.
     */
    reply: ownerOrOfficeNoTx
      .input(
        z.object({
          taskId: z.string().uuid(),
          version: z.number().int(),
          text: z.string().trim().max(4000).optional(),
          approvedToolUseIds: z.array(z.string()).optional(),
          deniedToolUseIds: z.array(z.string()).optional(),
        }),
      )
      .output(z.object({ status: z.enum(["completed", "needs_approval", "refused"]), task: taskDTO }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.llmClient) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "the AI assistant is not switched on for this server" });
        }
        const orgId = ctx.principal.orgId;
        const id = asAgentTaskId(input.taskId);
        const { text, approvedIds, deniedIds } = parseReplyInput(input);

        // Cheap fail-fast BEFORE the lease is touched. A stale client is the common case, and it
        // should not acquire and release a lease just to be told to reload. Everything that depends
        // on the transcript is re-read below, under the lease, because only then is it authoritative.
        const preflight = await withTenant(orgId, (tx) => new DrizzleAgentTaskRepository(tx, orgId).findById(id));
        if (!preflight) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
        assertVersion(preflight, input.version);

        /**
         * THE LEASE — ACQUIRED, not merely checked. The version check above is not enough on its
         * own: a due task can be mid-wake in the runner with an LLM call in flight and the lease
         * held, and the runner has not saved yet, so the version still matches and this reply would
         * sail through. Both turns would then run concurrently for the length of a round trip, and
         * while the version-guarded save at the end stops the DISPOSITION being corrupted, each
         * side's transcript appends have already committed independently by then.
         *
         * And checking alone leaves the worse case open: TWO HUMANS. `reply` is `ownerOrOfficeNoTx`
         * and takes nothing, so two office users on the shared "Needs you" queue — or one owner in
         * two browser tabs — can approve the SAME `tool_use` concurrently. `buildExecuteTool`
         * consults the execution ledger in its own short transaction, so both find nothing, both
         * execute, and the unique `(org_id, tool_use_id)` silently swallows the second ledger row
         * (`onConflictDoNothing`): two texts, or two payment records, and no error anywhere. That is
         * precisely the harm ADR 0008 §3 cites as the lease's reason to exist. Taking the lease for
         * the duration of the turn is the only thing that serializes those two callers.
         *
         * Refuse, never queue: no blocking and no polling. An EXPIRED `locked_until` counts as
         * absent (the acquire predicate and `isLeaseLive` agree), so a hard-killed worker cannot
         * strand the task behind a dead lock. CONFLICT is in error-map.ts's PASS_THROUGH set, so
         * this sentence reaches the user — and it is the code the drawer already recovers from.
         */
        const leaseId = ctx.deps.ids.newId();
        const leaseStart = ctx.deps.clock.now();
        const acquired = await withTenant(orgId, (tx) =>
          new DrizzleAgentTaskRepository(tx, orgId).acquireLease(
            id,
            leaseId,
            new Date(leaseStart.getTime() + REPLY_LEASE_MS),
            leaseStart,
          ),
        );
        if (!acquired) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Artie is working on this right now — give it a moment and reload.",
          });
        }

        // Released on EVERY exit path from here down, including a throw: a lease this request kept
        // would fence the runner out of the row for the whole REPLY_LEASE_MS window.
        try {
          const loaded = await loadForReply(orgId, id, input.version, { text, approvedIds, deniedIds });

          const catalog = toolsForRole(buildAgentTools(), ctx.principal.role);
          const meta: ToolMeta[] = catalog.map((t) => ({
            name: t.name, description: t.description, inputSchema: t.inputSchema, mutating: t.mutating,
          }));

          // Backed by the SAME repository the runner uses: `find` opens its own short read (a tool
          // we already ran for this exact tool_use is replayed, never re-executed); `record` reuses
          // the tool call's OWN tx (passed in by buildExecuteTool), so the ledger row commits in the
          // SAME transaction as the tool's business write — never one without the other.
          const ledger: ExecutionLedger = {
            find: (toolUseId) => withTenant(orgId, (tx) => new DrizzleAgentTaskRepository(tx, orgId).findExecution(toolUseId)),
            record: (tx, execution) => new DrizzleAgentTaskRepository(tx, orgId).recordExecution(id, execution),
          };
          const execute: ExecuteTool = buildExecuteTool({
            tools: catalog,
            // No delimitResults here: like v1.ai.run/resume (and unlike the unattended runner), a
            // human is watching this turn.
            ledger,
            runInTenant: (fn) =>
              withTenant(orgId, (tx) => {
                const deps: ToolDeps = {
                  bus: new OutboxEventBus(tx, orgId),
                  clock: ctx.deps.clock,
                  ids: ctx.deps.ids,
                  notificationSender: ctx.deps.notificationSender,
                  paymentLinkGateway: ctx.deps.paymentLinkGateway,
                };
                return fn({ tx, orgId, principal: ctx.principal, deps });
              }),
          });

          // Bytes for messages THIS turn appends, added to what the row already carried — the
          // runner is not the only writer that must keep transcript_bytes honest against the
          // 256KB guard (decideWake reads it), or an interactive-only task's count would drift
          // permanently below reality.
          let addedBytes = 0;
          const persist = async (message: AgentMessage): Promise<void> => {
            addedBytes += sizeOf(message);
            await withTenant(orgId, (tx) => new DrizzleAgentTaskRepository(tx, orgId).appendMessage(id, message));
          };

          let result: AgentResult;
          try {
            result = await runAgentTurn({
              llm: ctx.deps.llmClient,
              system: SYSTEM_PROMPT,
              tools: meta,
              execute,
              priorMessages: loaded.messages,
              userMessage: text,
              approvedToolUseIds: approvedIds,
              deniedToolUseIds: deniedIds,
              effort: "medium",
              onProgress: persist,
            });
          } catch (error: unknown) {
            const mapped = providerErrorOf(error);
            if (mapped) throw mapped;
            throw error;
          }

          const now = ctx.deps.clock.now();
          const settled = await withTenant(orgId, async (tx) => {
            const repo = new DrizzleAgentTaskRepository(tx, orgId);
            const current = await repo.findById(id);
            if (!current) return { kind: "gone" as const };
            /**
             * Lost the race while the turn was in flight: the runner finished/closed the task, or
             * the lease this request took is no longer the one on the row. Both are a CONFLICT the
             * drawer can recover from, never a BAD_REQUEST from a refused transition, and never a
             * write on a row somebody else now owns.
             *
             * The fence is `leaseId` EQUALITY, not `isLeaseLive` — because the live lease on this
             * row is now OURS, so "a lease is held" no longer means "someone else is working". A
             * mismatch (or a cleared lease) means our window expired and another worker reclaimed
             * the row, which is exactly the case where our turn must not write.
             */
            if (current.isTerminal() || current.props.leaseId !== leaseId) return { kind: "conflict" as const };
            const withBytes = current.withTranscriptBytes(current.props.transcriptBytes + addedBytes, now);
            // A human just engaged: put it back to work so the next tick continues it, unless the
            // turn is itself waiting on another approval.
            const next =
              result.status === "needs_approval"
                ? ok(withBytes.needsYou(result.assistantText || "I need your OK to continue", now))
                : withBytes.resume(now);
            if (!next.ok) return { kind: "conflict" as const };
            // THE VERSION RULE: expectedVersion is `current.props.version` — the version just READ
            // from the database in THIS transaction — never `next.value.props.version` (the aggregate
            // has already incremented itself twice in memory by this point and that value matches no
            // row).
            const saved = await repo.save(next.value, current.props.version);
            return saved ? { kind: "saved" as const, task: next.value } : { kind: "conflict" as const };
          });

          if (settled.kind === "gone") {
            throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
          }
          if (settled.kind === "conflict") {
            // Everything this turn did to the transcript (and to any approved tool's business
            // write) is already durably committed above; only the task's own status/version lost
            // the race — surfaced loudly rather than silently discarded.
            throw new TRPCError({
              code: "CONFLICT",
              message: "the assistant replied while you were typing — reload to see it",
            });
          }
          return { status: result.status, task: toTaskDTO(settled.task) };
        } finally {
          // Fenced on our OWN lease id, so a release can never clear a successor's lock. Logged
          // rather than thrown: the turn's own outcome (or its own error) is what the caller needs,
          // and a release that failed self-heals when `locked_until` expires anyway.
          try {
            await withTenant(orgId, (tx) => new DrizzleAgentTaskRepository(tx, orgId).releaseLease(id, leaseId));
          } catch (error: unknown) {
            logger.error(
              { taskId: id, err: error instanceof Error ? error.message : String(error) },
              "agent.reply.lease-release-failed",
            );
          }
        }
      }),
  });