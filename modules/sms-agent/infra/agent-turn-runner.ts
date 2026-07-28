import { withTenant } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import { OutboxEventBus } from "@mallet/shared/outbox";
import type { IdGenerator, JsonValue } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";
import {
  runAgentTurn,
  buildAgentTools,
  type LlmClient,
  type ToolMeta,
  type ExecuteTool,
  type ToolDeps,
  type AgentMessage,
  describeProposal,
} from "@mallet/ai";
import type { RunTurnInput, TurnResult } from "../app/handle-staff-sms";

// The SMS agent runs the SAME tools as the in-app assistant — Owen's call: "anything Mallet AI can
// do, text should be able to do." What differs is the voice and the confirmation surface.
//
// Every MUTATING tool still halts the loop and asks first (runAgentTurn's built-in gate); over text
// that becomes "Reply YES to confirm" instead of a button. So the capability is identical and the
// authorisation step is preserved rather than skipped.
const SYSTEM_PROMPT = [
  "You are MALLET, talking to a member of staff over SMS. You are not talking to a customer.",
  "",
  "WHO YOU ARE:",
  "- You are Mallet, the software this shop runs on. You work FOR the staffer reading this.",
  "- Never introduce yourself as the shop or as the shop's assistant. Tools will tell you the",
  "  shop's name (Summit Commercial Cleaning, and so on) — that is the name of THEIR business,",
  "  the customer you are helping, never your own identity. Saying \"I'm <shop>'s assistant\" to",
  "  the person who owns that shop is backwards.",
  "- No greeting or self-introduction unless asked who you are. Answer the message.",
  "",
  "WRITING FOR TEXT:",
  "- Keep replies under 320 characters. They are read on a phone, often one-handed on a job site.",
  "- Plain text only. No markdown, no bullets, no headings, no emoji — a phone renders none of it.",
  "- Answer the question and stop. No preamble, no offering further help.",
  "- Money as $1,234. Dates as 'Thu 8am', not ISO timestamps.",
  "- If a list is unavoidable, use short lines separated by newlines, no bullet characters.",
  "",
  "DOING THINGS:",
  "- Anything that CHANGES something pauses for confirmation automatically. Do not ask for",
  "  permission yourself in the text — state plainly what you are about to do and let the",
  "  confirmation step handle it. Asking twice reads as broken.",
  "- If you need a detail you do not have (which job, which customer), ask ONE short question.",
  "- Never invent an id, a price, or a name. Look it up with a tool or ask.",
].join("\n");

// A text is not a research task. The in-app assistant runs at high effort with 16k of output
// headroom because it is answering into a panel someone is watching; over SMS the same settings buy
// deliberation nobody asked for while the staffer stares at a phone on a job site.
//
// `effort: "low"` is the big lever — it is what decides how long the model deliberates before
// answering, and "look up my schedule" or "add this customer" are lookups, not reasoning problems.
const SMS_EFFORT = "low" as const;

// runAgentTurn never passes maxTokens, so every call inherits the client's 16,000 default. With
// adaptive thinking on, that is a lot of rope. A 320-character reply plus tool-call JSON fits well
// inside this, and a smaller ceiling bounds the worst case rather than the typical one.
const SMS_MAX_TOKENS = 4_000;

/**
 * Caps output tokens for SMS turns.
 *
 * A decorator rather than a change to runAgentTurn: maxTokens is a property of THIS channel (short
 * replies to a phone), not of the agent loop, and the in-app assistant should keep its headroom.
 */
const withSmsLimits = (llm: LlmClient): LlmClient => ({
  next: (request) => llm.next({ ...request, maxTokens: SMS_MAX_TOKENS }),
});

export interface AgentTurnRunnerDeps {
  readonly llm: LlmClient;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly notificationSender: ToolDeps["notificationSender"];
  readonly paymentLinkGateway: ToolDeps["paymentLinkGateway"];
}

// The transcript is stored as an opaque JSON string (that is how runAgentTurn hands it out and
// takes it back). A malformed value must start a fresh conversation rather than throw — losing
// context is recoverable, dropping the staffer's message is not.
const parseTranscript = (raw: string | null): AgentMessage[] | undefined => {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentMessage[]) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Build the `runTurn` dependency handleStaffSms needs.
 *
 * Each tool call opens its OWN short withTenant transaction (mirroring the in-app driver) rather
 * than holding one open across the whole multi-minute turn — a transaction held for the length of
 * an LLM conversation would pin a connection and block migrations.
 */
export function makeAgentTurnRunner(deps: AgentTurnRunnerDeps) {
  return async (input: RunTurnInput): Promise<TurnResult> => {
    // Tenant comes from the resolved staffer, never from a caller-supplied value.
    const orgId = input.staff.orgId;
    const principal: Principal = {
      userId: input.staff.userId,
      orgId,
      // The staffer's REAL role, not a sentinel. time_entries.tech_user_id is NOT NULL with a
      // composite FK to users, so a fake id would fail the insert — and attributing one person's
      // hours to another is worse than failing.
      role: input.staff.role,
    };

    const tools = buildAgentTools();
    const meta: ToolMeta[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      mutating: t.mutating,
    }));

    const execute: ExecuteTool = (name, toolInput) => {
      const tool = tools.find((t) => t.name === name);
      if (!tool) return Promise.resolve({ ok: false, error: `unknown tool: ${name}` });
      return withTenant(orgId, (tx) => {
        const toolDeps: ToolDeps = {
          bus: new OutboxEventBus(tx, orgId),
          clock: deps.clock,
          ids: deps.ids,
          notificationSender: deps.notificationSender,
          paymentLinkGateway: deps.paymentLinkGateway,
        };
        const toolCtx = { tx, orgId, principal, deps: toolDeps };
        const enriched =
          toolInput && typeof toolInput === "object" && tool.enrichArgs
            ? { ...(toolInput as Record<string, unknown>), ...tool.enrichArgs(toolInput as Record<string, unknown>, toolCtx) }
            : toolInput;
        return tool.handle(enriched, toolCtx);
      });
    };

    const startedAt = Date.now();
    const result = await runAgentTurn({
      llm: withSmsLimits(deps.llm),
      system: SYSTEM_PROMPT,
      tools: meta,
      execute,
      effort: SMS_EFFORT,
      userMessage: input.userMessage,
      priorMessages: parseTranscript(input.transcript),
      approvedToolUseIds: input.approvedToolUseIds,
      deniedToolUseIds: input.deniedToolUseIds,
    });

    // Timed so "it takes a while" is a number next time, not an impression. Turn count is the
    // other half — a slow turn with six tool calls is a different problem from a slow single call.
    logger.info(
      {
        orgId,
        status: result.status,
        durationMs: Date.now() - startedAt,
        transcriptMessages: result.transcript.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      "sms.agent.turn.completed",
    );

    const transcript = JSON.stringify(result.transcript);

    if (result.status === "needs_approval") {
      return {
        status: "needs_approval",
        assistantText: result.assistantText,
        // Same describeProposal the in-app approval panel uses, so a confirmation reads
        // identically whether it arrives on screen or as a text.
        pending: result.pending.map((p) => ({
          toolUseId: p.toolUseId,
          tool: p.tool,
          summary: describeProposal(p.tool, (p.input ?? {}) as Record<string, JsonValue>),
        })),
        transcript,
      };
    }
    return { status: result.status, text: result.text, transcript };
  };
}
