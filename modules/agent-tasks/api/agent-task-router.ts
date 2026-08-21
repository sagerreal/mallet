import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, ownerOrOfficeNoTx } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { asAgentTaskId, toPage } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";
import {
  buildAgentTools, buildExecuteTool, describeProposal, runAgentTurn, toolsForRole, LlmError, SYSTEM_PROMPT,
  type AgentMessage, type AgentResult, type ExecuteTool, type ExecutionLedger, type PendingAction,
  type ToolDeps, type ToolMeta,
} from "@mallet/ai";
import { DrizzleAgentTaskRepository } from "../infra/drizzle-agent-task-repository";
import { CreateAgentTaskUseCase } from "../app/create-agent-task";
import type { AgentTask } from "../domain/agent-task";
import { TITLE_MAX } from "../app/agent-task-config";

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
        const task = await repo.findById(asAgentTaskId(input.taskId));
        if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });
        const closed = orThrow(task.close(ctx.deps.clock.now()));
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

        const loaded = await withTenant(orgId, async (tx) => {
          const repo = new DrizzleAgentTaskRepository(tx, orgId);
          const task = await repo.findById(id);
          if (!task) return null;
          return { task, messages: await repo.loadMessages(id) };
        });
        if (!loaded) throw new TRPCError({ code: "NOT_FOUND", message: "that task does not exist" });

        // Optimistic concurrency: if the runner (or another reply) already moved this task on,
        // this reply must lose loudly rather than silently overwrite what happened while the
        // owner was typing.
        if (loaded.task.props.version !== input.version) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "the assistant replied while you were typing — reload to see it",
          });
        }

        if (approvedIds.length > 0 || deniedIds.length > 0) {
          assertIdsArePending(loaded.messages, approvedIds, deniedIds);
        }

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
          const withBytes = current.withTranscriptBytes(current.props.transcriptBytes + addedBytes, now);
          // A human just engaged: put it back to work so the next tick continues it, unless the
          // turn is itself waiting on another approval.
          const next =
            result.status === "needs_approval"
              ? withBytes.needsYou(result.assistantText || "I need your OK to continue", now)
              : orThrow(withBytes.resume(now));
          // THE VERSION RULE: expectedVersion is `current.props.version` — the version just READ
          // from the database in THIS transaction — never `next.props.version` (the aggregate has
          // already incremented itself twice in memory by this point and that value matches no
          // row).
          const saved = await repo.save(next, current.props.version);
          return saved ? { kind: "saved" as const, task: next } : { kind: "conflict" as const };
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
      }),
  });
