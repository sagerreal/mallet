import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOfficeNoTx } from "@/trpc/init";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";
import { buildAgentTools } from "../infra/agent-tools";
import { fetchEstimateContext, fetchJobInfoContext } from "../infra/estimate-context";
import { runAgentTurn, type AgentResult, type ExecuteTool, type ToolMeta } from "../app/run-agent-turn";
import { LlmError, type AgentMessage } from "../domain/llm-client";
import type { ToolDeps } from "../domain/tool";
import { describeProposal } from "../domain/proposal-summary";
import type { JsonValue } from "@mallet/shared/ports";
import { draftEstimateLines, type EstimateLineDraft } from "../app/draft-estimate";
import { draftChecklist } from "../app/draft-checklist";
import { draftEstimateTiers, type EstimateTiersDraft } from "../app/draft-estimate-tiers";
import { stagesFor, EMPTY_ESTIMATE_CONTEXT } from "../app/estimate-context";
import { asLeadId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";

// Structural validation of an untrusted resume transcript (round-tripped through the client). Mirrors
// the AgentMessage union so a malformed element becomes a clean BAD_REQUEST, not a 500 deep in the
// adapter. (Tenancy is already safe — org is re-derived server-side — this is input hygiene.)
const assistantBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
]);
const transcriptSchema = z.array(
  z.union([
    z.object({ role: z.literal("user"), kind: z.literal("text"), text: z.string() }),
    z.object({ role: z.literal("user"), kind: z.literal("tool_results"), results: z.array(z.object({ toolUseId: z.string(), content: z.string(), isError: z.boolean().optional() })) }),
    z.object({ role: z.literal("assistant"), kind: z.literal("assistant"), blocks: z.array(assistantBlockSchema) }),
  ]),
);

// The unified agent's system prompt. Byte-identical across tenants (RLS scopes data at execution,
// never by varying the prompt) so the cached prefix always hits. No org name / no timestamps — call
// `get_context` at the start of a fresh conversation to learn those.
const SYSTEM_PROMPT = [
  "You are Artie, Mallet's operations assistant for a field-service business (plumbers, electricians, HVAC, and similar trades).",
  "You help the office get work done by USING TOOLS in a loop — look things up, then take actions — not by guessing.",
  "",
  "## Workflow",
  "1. LOOK UP first. Use the read tools to find real ids, names, and statuses before acting.",
  "2. ACT with the write tools. Mutating tools require the user's approval — the system pauses and shows them what you want to do.",
  "3. PAUSE for confirmation. When a write tool is queued, briefly state what you are about to do and why; then wait.",
  "",
  "## Read tools (run immediately, no approval needed)",
  "- get_context — org name + today's date; call this at the start of a new conversation.",
  "- customer_list / customer_get — customers and leads.",
  "- invoice_list / invoice_get — invoices (INV-…) with status and balance.",
  "- estimate_list / estimate_get — quotes (EST-…) with status and total.",
  "- job_list / job_get — field jobs with visits and schedule.",
  "- task_list — open or completed tasks.",
  "- member_list — team roster; use ids when assigning jobs.",
  "- company_list / company_get — B2B company accounts.",
  "- timesheet_list — time entries with hours and approval status.",
  "- notification_list_due_reminders — invoices whose next follow-up is due now.",
  "",
  "## Write tools (pause for user approval before executing)",
  "- quote_draft — draft a new estimate for a customer.",
  "- quote_send — send a drafted estimate to the customer.",
  "- invoice_draft — draft an invoice for a customer.",
  "- invoice_send — send a draft invoice and start payment terms.",
  "- invoice_create_from_job — generate an invoice from a completed job.",
  "- notification_send_invoice_reminder — send an invoice reminder via SMS or email.",
  "- job_schedule — schedule a new field job for a lead.",
  "- job_assign — reassign a job to a different crew member.",
  "- schedule_visit — add a visit (date/time/assignee) to an existing job.",
  "- task_create — create a task, optionally linked to a customer.",
  "- customer_create — add a new customer/lead.",
  "",
  "## Sensitive write tools (pause + extra care)",
  "- invoice_record_payment — record a cash/check/card/ACH payment; idempotent (safe to retry).",
  "- invoice_void — permanently void an invoice; irreversible.",
  "- timesheet_approve_week — approve a technician's time entries for a date range.",
  "",
  "## Rules",
  "- Reference entities by their human number (INV-…, EST-…, JOB-…) and dollar amounts; never raw UUIDs in prose.",
  "- If a tool errors, read the message, fix the input, and retry — do not repeat an identical failing call.",
  "- Only do what was asked. If the request is ambiguous, ask one short clarifying question instead of acting.",
  "- Do not invent ids or names; always look them up first.",
].join("\n");

const usageDTO = z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number() });
// A single pending tool-use action awaiting human approval. `summary` is a human-readable one-liner
// derived server-side via describeProposal so the frontend never needs to re-parse argsJson for display.
const pendingItemSchema = z.object({
  toolUseId: z.string(),
  tool: z.string(),
  argsJson: z.string(),
  summary: z.string(),
});
const runOutput = z.object({
  status: z.enum(["completed", "needs_approval", "refused"]),
  // completed/refused: the answer. needs_approval: the assistant's explanation of what it wants to do.
  text: z.string(),
  // Populated only when status === "needs_approval": the action(s) awaiting a human tap.
  pending: z.array(pendingItemSchema),
  // Opaque conversation state to pass back to `resume` (JSON). The org is re-derived server-side on
  // resume, so a tampered transcript cannot cross tenants and action tools still re-gate.
  transcript: z.string(),
  usage: usageDTO,
});

const toOutput = (result: AgentResult) => {
  const transcript = JSON.stringify(result.transcript);
  if (result.status === "needs_approval") {
    return {
      status: "needs_approval" as const,
      text: result.assistantText,
      pending: result.pending.map((p) => {
        const args = (p.input && typeof p.input === "object" && !Array.isArray(p.input))
          ? (p.input as Record<string, unknown>)
          : {};
        return {
          toolUseId: p.toolUseId,
          tool: p.tool,
          argsJson: JSON.stringify(p.input),
          summary: describeProposal(p.tool, args as Record<string, JsonValue>),
        };
      }),
      transcript,
      usage: result.usage,
    };
  }
  return { status: result.status, text: result.text, pending: [], transcript, usage: result.usage };
};

// ---- Estimate line draft types (re-exported for tests) ----------------------
export type { EstimateLineDraft, EstimateTiersDraft };

// Output shapes for the one-shot drafters (integer cents on the wire).
const draftLineDTO = z.object({
  description: z.string(),
  quantity: z.number(),
  rateCents: z.number().int(),
});
const draftTierDTO = z.object({
  // One-line "what this option covers" blurb; "" when the model omitted it.
  // Display-only — it fills the composer panel and is never persisted.
  note: z.string(),
  lines: z.array(draftLineDTO),
});

// The office's correction to an earlier draft — regenerates with the prior
// lines + feedback in the prompt, and may extract durable-fact proposals.
const refineInput = z.object({
  feedback: z.string().min(1).max(1_000),
  previousLines: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        // Explicit .finite(): superjson round-trips Infinity and a non-finite
        // quantity would reach the prompt builder. Zod 4 already rejects
        // non-finite numbers; this pins the behavior against upgrades.
        quantity: z.number().nonnegative().finite(),
        rateCents: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(30),
});

// One-tap chips: labor_hours → pricebook write-back; rule → quoting_rules.
const proposalDTO = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("labor_hours"), serviceName: z.string(), hours: z.number() }),
  z.object({ kind: z.literal("rule"), rule: z.string() }),
]);

// Real-artifact counts for the composer's run reveal — every number reflects data actually
// read for THIS draft (labor-illusion honesty: never render a stage that didn't happen).
const draftStagesDTO = z.object({
  jobInfo: z
    .object({ notes: z.number().int(), texts: z.number().int(), visitNotes: z.number().int() })
    .nullable(),
  pricebook: z.object({ services: z.number().int(), laborRates: z.number().int() }),
  // Optional so clients degrade gracefully across deploy skew (a stages payload
  // minted before the rules stage existed simply omits it — never a fake stage).
  rules: z.object({ count: z.number().int() }).optional(),
  wonQuotes: z.object({ count: z.number().int(), nums: z.array(z.string()) }),
});

export const createAiRouter = () =>
  router({
    // One-shot LLM call: given a plain-English job description, return itemised estimate lines.
    // Does NOT require the agent loop — single round-trip, forced tool call.
    draftEstimate: ownerOrOfficeNoTx
      .input(
        z.object({
          description: z.string().min(1).max(2000),
          leadId: z.string().uuid().optional(),
          refine: refineInput.optional(),
        }),
      )
      .output(
        z.object({
          lines: z.array(z.object({ description: z.string(), quantity: z.number(), rateCents: z.number().int() })),
          proposals: z.array(proposalDTO),
          stages: draftStagesDTO,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.llmClient) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
        }
        try {
          // Short read-only tx (mirrors execute()'s per-tool-call withTenant below) to gather the
          // org's real context (pricebook, labor rates, lead's job info, won-quote exemplars) —
          // closed before the slow LLM round-trip.
          const context = await withTenant(ctx.principal.orgId, (tx) =>
            fetchEstimateContext(tx, ctx.principal.orgId, input.description, input.leadId),
          );
          const result = await draftEstimateLines(ctx.deps.llmClient, input.description, context, input.refine);
          return { lines: result.lines, proposals: result.proposals, stages: stagesFor(context) };
        } catch (error) {
          if (error instanceof LlmError) {
            throw new TRPCError({
              code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
              message: "the AI assistant is temporarily unavailable — please try again",
            });
          }
          throw error;
        }
      }),

    // One-shot LLM call: given a job type, draft a before-you-leave checklist (AI Foreman 1A.4).
    // Suggest-only — the items land in the checklist editor for the owner to edit/save; nothing
    // is written here. No DB read needed (the job type IS the context), so no withTenant tx.
    draftChecklist: ownerOrOfficeNoTx
      .input(z.object({ jobType: z.string().min(1).max(120) }))
      .output(
        z.object({
          items: z.array(z.object({ text: z.string(), type: z.enum(["check", "photo"]) })),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.llmClient) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "AI is not configured" });
        }
        try {
          return await draftChecklist(ctx.deps.llmClient, input.jobType);
        } catch (error) {
          if (error instanceof LlmError) {
            throw new TRPCError({
              code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
              message: "the AI assistant is temporarily unavailable — please try again",
            });
          }
          throw error;
        }
      }),

    // One-shot LLM call: given a plain-English job description, return a full Good/Better/Best
    // draft — three tiers of lines plus the model's recommended key. Mirrors draftEstimate
    // (single round-trip, forced tool call); the unconfigured guard lives in the use-case.
    draftEstimateTiers: ownerOrOfficeNoTx
      .input(
        z.object({
          description: z.string().min(1).max(2000),
          leadId: z.string().uuid().optional(),
          refine: refineInput.optional(),
        }),
      )
      .output(
        z.object({
          recommended: z.enum(["good", "better", "best"]),
          good: draftTierDTO,
          better: draftTierDTO,
          best: draftTierDTO,
          proposals: z.array(proposalDTO),
          stages: draftStagesDTO,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        try {
          // Same context as the single drafter — the tiers previously ran on "typical trade
          // pricing" alone while the composer claimed pricebook grounding.
          const context = ctx.deps.llmClient
            ? await withTenant(ctx.principal.orgId, (tx) =>
                fetchEstimateContext(tx, ctx.principal.orgId, input.description, input.leadId),
              )
            : undefined;
          const tiers = await draftEstimateTiers(ctx.deps.llmClient, input.description, context, input.refine);
          return { ...tiers, stages: stagesFor(context ?? EMPTY_ESTIMATE_CONTEXT) };
        } catch (error) {
          if (error instanceof LlmError) {
            throw new TRPCError({
              code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
              message: "the AI assistant is temporarily unavailable — please try again",
            });
          }
          throw error;
        }
      }),

    // Start (or continue) an agent conversation from a user instruction.
    // When `transcript` is supplied it is the client-round-tripped conversation state from a prior
    // Pre-flight job context for the composer's run reveal: what we already know about the
    // lead's job (notes, texts, field findings) with real counts. Deterministic DB reads only —
    // no LLM. The drafters gather the same context server-side; this exists so the UI can show
    // true artifact counts the moment a run starts.
    gatherJobContext: ownerOrOfficeNoTx
      .input(z.object({ leadId: z.string().uuid() }))
      .output(
        z.object({
          lead: z
            .object({
              name: z.string(),
              source: z.string().nullable(),
              notes: z.string().nullable(),
              address: z.string().nullable(),
            })
            .nullable(),
          messages: z.array(z.object({ direction: z.enum(["inbound", "outbound"]), body: z.string() })),
          visitNotes: z.array(z.string()),
          counts: z.object({ notes: z.number().int(), texts: z.number().int(), visitNotes: z.number().int() }),
        }),
      )
      .query(async ({ ctx, input }) => {
        const jobInfo = await withTenant(ctx.principal.orgId, (tx) =>
          fetchJobInfoContext(tx, ctx.principal.orgId, asLeadId(input.leadId)),
        );
        if (!jobInfo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "customer not found" });
        }
        return {
          lead: jobInfo.lead,
          messages: [...jobInfo.messages],
          visitNotes: [...jobInfo.visitNotes],
          counts: {
            notes: jobInfo.lead?.notes?.trim() ? 1 : 0,
            texts: jobInfo.messages.length,
            visitNotes: jobInfo.visitNotes.length,
          },
        };
      }),

    // turn — validated with the same transcriptSchema that `resume` uses so a malformed payload
    // yields a clean BAD_REQUEST, not a 500. The org is ALWAYS re-derived from the verified
    // principal; the transcript carries conversation content only and is never trusted for tenancy.
    run: ownerOrOfficeNoTx
      .input(z.object({ message: z.string().min(1), transcript: z.string().optional() }))
      .output(runOutput)
      .mutation(async ({ ctx, input }) => {
        let priorMessages: AgentMessage[] | undefined;
        if (input.transcript !== undefined) {
          try {
            const parsed = transcriptSchema.safeParse(JSON.parse(input.transcript));
            if (!parsed.success) throw new Error("bad shape");
            priorMessages = parsed.data as AgentMessage[];
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid transcript" });
          }
        }
        return toOutput(await drive(ctx, { userMessage: input.message, priorMessages }));
      }),

    // Resume a paused turn after the human approves/denies the pending action(s).
    resume: ownerOrOfficeNoTx
      .input(
        z.object({
          transcript: z.string(),
          approvedToolUseIds: z.array(z.string()).optional(),
          deniedToolUseIds: z.array(z.string()).optional(),
        }),
      )
      .output(runOutput)
      .mutation(async ({ ctx, input }) => {
        let priorMessages: AgentMessage[];
        try {
          const parsed = transcriptSchema.safeParse(JSON.parse(input.transcript));
          if (!parsed.success) throw new Error("bad shape");
          priorMessages = parsed.data as AgentMessage[];
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalid transcript" });
        }

        // Cross-check that every approved/denied id actually appears as an assistant
        // tool_use block id in the validated transcript. A caller should never be able
        // to approve a tool_use that isn't actually pending in their conversation.
        const toolUseIdsInTranscript = new Set<string>(
          priorMessages.flatMap((m) =>
            m.role === "assistant" && m.kind === "assistant"
              ? m.blocks.flatMap((b) => (b.type === "tool_use" ? [b.id] : []))
              : [],
          ),
        );
        const allSubmittedIds = [
          ...(input.approvedToolUseIds ?? []),
          ...(input.deniedToolUseIds ?? []),
        ];
        const forged = allSubmittedIds.find((id) => !toolUseIdsInTranscript.has(id));
        if (forged !== undefined) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "approved/denied id not found in transcript" });
        }

        return toOutput(
          await drive(ctx, {
            priorMessages,
            approvedToolUseIds: input.approvedToolUseIds,
            deniedToolUseIds: input.deniedToolUseIds,
          }),
        );
      }),
  });

// Shared driver: builds the per-call tool executor (short withTenant tx + outbox-bound bus, org from
// the verified principal) and runs the loop on the configured model.
const drive = async (
  ctx: { principal: Principal; deps: AppDeps },
  turn: { userMessage?: string; priorMessages?: AgentMessage[]; approvedToolUseIds?: string[]; deniedToolUseIds?: string[] },
): Promise<AgentResult> => {
  if (!ctx.deps.llmClient) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "the AI assistant is not switched on for this server" });
  }
  const tools = buildAgentTools();
  const meta: ToolMeta[] = tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, mutating: t.mutating }));
  const execute: ExecuteTool = (name, input) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return Promise.resolve({ ok: false, error: `unknown tool: ${name}` });
    return withTenant(ctx.principal.orgId, (tx) => {
      const deps: ToolDeps = {
        bus: new OutboxEventBus(tx, ctx.principal.orgId),
        clock: ctx.deps.clock,
        ids: ctx.deps.ids,
        notificationSender: ctx.deps.notificationSender,
        paymentLinkGateway: ctx.deps.paymentLinkGateway,
      };
      const toolCtx = { tx, orgId: ctx.principal.orgId, principal: ctx.principal, deps };
      // Mirror the MCP propose path: server-mint any enriched args (e.g. the payment idempotency
      // key) here so handle() receives them — the in-app loop executes each approved tool_use once,
      // so minting at execute time is replay-safe (ON CONFLICT DO NOTHING is the DB backstop).
      const enriched =
        input && typeof input === "object" && tool.enrichArgs
          ? { ...(input as Record<string, unknown>), ...tool.enrichArgs(input as Record<string, unknown>, toolCtx) }
          : input;
      return tool.handle(enriched, toolCtx);
    });
  };
  try {
    const result = await runAgentTurn({
      llm: ctx.deps.llmClient,
      system: SYSTEM_PROMPT,
      tools: meta,
      execute,
      effort: "high",
      userMessage: turn.userMessage,
      priorMessages: turn.priorMessages,
      approvedToolUseIds: turn.approvedToolUseIds,
      deniedToolUseIds: turn.deniedToolUseIds,
    });
    logger.info(
      {
        orgId: ctx.principal.orgId,
        status: result.status,
        transcriptMessages: result.transcript.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
      },
      "agent.turn.completed",
    );
    return result;
  } catch (error) {
    // A provider failure surfaces as a clean, retryable-aware error (not a raw 500). The adapter
    // already logged the provider detail server-side.
    if (error instanceof LlmError) {
      throw new TRPCError({ code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY", message: "the AI assistant is temporarily unavailable — please try again" });
    }
    throw error;
  }
};
