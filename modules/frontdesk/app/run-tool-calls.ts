import type { OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import type { TenantTx } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import type { ToolInvocationLedger } from "../domain/call-record";
import type { VoiceTool, VoiceToolContext, VoiceToolDeps, VoiceToolResult } from "./tools/tool-result";

// Spoken fallbacks (constants over magic strings). Each is what the caller HEARS when a tool call
// can't complete — plain, non-technical, and it always promises office follow-up so no request is
// silently dropped. None leaks an error code, a dollar amount, or PII.
export const FALLBACK_UNKNOWN_TOOL =
  "Sorry, I can't do that right now — let me have the office follow up with you.";
export const FALLBACK_INVALID_ARGS =
  "Sorry, I didn't catch that — let me have the office follow up with you.";
export const FALLBACK_EXECUTION_ERROR =
  "Sorry, something went wrong on my end — I've flagged it so the office follows up with you.";

// Text of the auto follow-up task filed when a tool THROWS mid-execution (an unexpected failure, not
// bad input). Invalid args only get a spoken fallback + a log — auto-filing a task on every fumbled
// argument would flood the office queue.
export const AUTO_FOLLOWUP_TASK_TEXT = "AI call — caller needs follow-up (tool error)";

// One tool call as Vapi delivers it in `message.toolCallList`. `arguments` is the model-supplied
// JSON object; it is untrusted and validated by each tool's zod `input` before the handler runs.
export interface VapiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

// The base context for a batch of tool calls — the parts that are constant across every call in one
// Vapi tool-calls message. `tx` is the short tenant transaction the route opened inside withTenant;
// `orgId`/`principal` come from the To-number lookup, never from tool arguments.
export interface RunToolCallsBaseContext {
  readonly tx: TenantTx;
  readonly orgId: OrgId;
  readonly principal: Principal;
}

export interface RunToolCallsInput {
  readonly vapiCallId: string;
  readonly toolCalls: readonly VapiToolCall[];
  readonly ctx: RunToolCallsBaseContext;
}

// The Vapi tool-calls response shape: one `{ toolCallId, result }` per call, where `result` is a
// JSON string of the VoiceToolResult (Vapi reads `speak` from it). The route serializes this array
// straight into `{ results }`.
export interface RunToolCallsOutput {
  readonly results: readonly { readonly toolCallId: string; readonly result: string }[];
}

// Builds the per-call tool dependencies from the tenant tx. Injected (not hardcoded) so the runner
// never touches drizzle directly and tests supply fakes — DI + repository pattern.
export type VoiceToolDepsFactory = (base: RunToolCallsBaseContext) => VoiceToolDeps;

// Runs the tool calls Vapi delivers in one tool-calls message. Idempotent per toolCallId via the
// ledger (Vapi retries webhooks; a replay returns the stored result and NEVER re-executes — the
// double-booking guard). It NEVER throws to the caller: every branch resolves to a spoken result so
// the route can always 200 with a `results` array. No silent failures — every fallback is logged.
export class RunToolCallsUseCase {
  constructor(
    private readonly tools: readonly VoiceTool[],
    private readonly ledger: ToolInvocationLedger,
    private readonly depsFactory: VoiceToolDepsFactory,
  ) {}

  async exec(input: RunToolCallsInput): Promise<RunToolCallsOutput> {
    const deps = this.depsFactory(input.ctx);
    const toolCtx: VoiceToolContext = {
      tx: input.ctx.tx,
      orgId: input.ctx.orgId,
      principal: input.ctx.principal,
      deps,
    };

    const results: { toolCallId: string; result: string }[] = [];
    for (const call of input.toolCalls) {
      const result = await this.runOne(input.vapiCallId, call, toolCtx);
      results.push({ toolCallId: call.id, result: serialize(result) });
    }
    return { results };
  }

  private async runOne(
    vapiCallId: string,
    call: VapiToolCall,
    ctx: VoiceToolContext,
  ): Promise<VoiceToolResult> {
    // (a) Idempotency: a replayed toolCallId returns the stored result, no re-execution.
    const prior = await this.ledger.find(vapiCallId, call.id);
    if (prior) {
      logger.info(
        { vapiCallId, tool: call.name, toolCallId: call.id },
        "frontdesk.tool.replay_hit",
      );
      return asVoiceToolResult(prior.result);
    }

    // (b) Unknown tool → spoken fallback (whitelist is the gate). No task; nothing to act on.
    const tool = this.tools.find((t) => t.name === call.name);
    if (!tool) {
      logger.warn({ vapiCallId, tool: call.name, toolCallId: call.id }, "frontdesk.tool.unknown");
      return this.saveAndReturn(vapiCallId, call, ctx.orgId, { speak: FALLBACK_UNKNOWN_TOOL });
    }

    // (c) Validate model-supplied arguments. Invalid → spoken fallback + log only (no auto task).
    const parsed = tool.input.safeParse(call.arguments);
    if (!parsed.success) {
      logger.warn(
        { vapiCallId, tool: call.name, toolCallId: call.id },
        "frontdesk.tool.invalid_args",
      );
      return this.saveAndReturn(vapiCallId, call, ctx.orgId, { speak: FALLBACK_INVALID_ARGS });
    }

    // (d) Execute inside try/catch. A throw is an UNEXPECTED failure → spoken fallback + an auto
    //     follow-up task so the request is never silently lost.
    try {
      const result = await tool.handle(parsed.data, ctx);
      logger.info(
        { vapiCallId, tool: call.name, toolCallId: call.id },
        "frontdesk.tool.executed",
      );
      return this.saveAndReturn(vapiCallId, call, ctx.orgId, result);
    } catch (error: unknown) {
      logger.error(
        { vapiCallId, tool: call.name, toolCallId: call.id, error: messageOf(error) },
        "frontdesk.tool.threw",
      );
      await this.fileFollowUp(ctx);
      return this.saveAndReturn(vapiCallId, call, ctx.orgId, { speak: FALLBACK_EXECUTION_ERROR });
    }
  }

  // Persist the result to the ledger (idempotency) then return it. save is idempotent on
  // (org_id, tool_call_id); a save failure must not lose the spoken result, so it is logged and the
  // result still returned (the caller still hears a coherent reply).
  private async saveAndReturn(
    vapiCallId: string,
    call: VapiToolCall,
    orgId: OrgId,
    result: VoiceToolResult,
  ): Promise<VoiceToolResult> {
    try {
      await this.ledger.save({ orgId, vapiCallId, toolCallId: call.id, tool: call.name, result });
    } catch (error: unknown) {
      logger.error(
        { vapiCallId, tool: call.name, toolCallId: call.id, error: messageOf(error) },
        "frontdesk.tool.ledger_save_failed",
      );
    }
    return result;
  }

  // File a best-effort office follow-up task after an execution throw. Wrapped in its own try/catch:
  // a failure here must not mask the spoken fallback the caller is waiting on.
  private async fileFollowUp(ctx: VoiceToolContext): Promise<void> {
    try {
      await ctx.deps.createTask.exec(
        { leadId: null, text: AUTO_FOLLOWUP_TASK_TEXT, dueDate: null },
        ctx.orgId,
      );
    } catch (error: unknown) {
      logger.error(
        { orgId: ctx.orgId, error: messageOf(error) },
        "frontdesk.tool.followup_task_failed",
      );
    }
  }
}

// Serialize a VoiceToolResult for Vapi's `results[].result` (a JSON string containing `speak`).
const serialize = (result: VoiceToolResult): string => JSON.stringify(result);

// Narrow an untyped ledger row back to a VoiceToolResult. The ledger stores exactly what we saved,
// but it types the payload as `unknown`; we recover `speak` defensively and never trust the shape.
const asVoiceToolResult = (stored: unknown): VoiceToolResult => {
  if (stored && typeof stored === "object" && "speak" in stored) {
    const speak = (stored as { speak: unknown }).speak;
    if (typeof speak === "string") {
      const data =
        "data" in stored && isRecord((stored as { data: unknown }).data)
          ? (stored as { data: Record<string, unknown> }).data
          : undefined;
      return data ? { speak, data } : { speak };
    }
  }
  return { speak: FALLBACK_EXECUTION_ERROR };
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "unknown error";
