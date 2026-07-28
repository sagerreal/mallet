import { withTenant } from "@mallet/shared/db/tx";
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
  "You are Mallet's assistant, talking to a member of staff over SMS. You are not talking to a customer.",
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

    const result = await runAgentTurn({
      llm: deps.llm,
      system: SYSTEM_PROMPT,
      tools: meta,
      execute,
      effort: "high",
      userMessage: input.userMessage,
      priorMessages: parseTranscript(input.transcript),
      approvedToolUseIds: input.approvedToolUseIds,
      deniedToolUseIds: input.deniedToolUseIds,
    });

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
