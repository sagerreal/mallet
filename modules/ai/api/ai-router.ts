import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOfficeNoTx } from "@/trpc/init";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";
import { buildAgentTools } from "../infra/agent-tools";
import { runAgentTurn, type AgentResult, type ExecuteTool, type ToolMeta } from "../app/run-agent-turn";
import type { AgentMessage } from "../domain/llm-client";
import type { ToolDeps } from "../domain/tool";

// The unified agent's system prompt. Byte-identical across tenants (RLS scopes data at execution,
// never by varying the prompt) so the cached prefix always hits. No org name / no timestamps.
const SYSTEM_PROMPT = [
  "You are Mallet's operations assistant for a field-service business (plumbers, electricians, HVAC, and similar trades).",
  "You help the office get work done by USING TOOLS in a loop — look things up, then take actions — not by guessing.",
  "",
  "How to work:",
  "- Prefer looking up real data with the read tools before acting. Reference customers, invoices, and estimates by the ids the tools return.",
  "- Take actions with the action tools. Actions that change data or contact a customer require the user's approval — the system pauses and asks before running them, so propose the action and briefly say why.",
  "- If a tool returns an error, read it and either fix your input or try another approach; don't repeat the same failing call.",
  "- Be concise and concrete. Refer to invoices/estimates by their number (INV-…, EST-…), amounts in dollars.",
  "- Only do what was asked. If a request is ambiguous or you lack the information, ask a short clarifying question instead of acting.",
].join("\n");

const usageDTO = z.object({ inputTokens: z.number(), outputTokens: z.number(), cacheReadTokens: z.number() });
const runOutput = z.object({
  status: z.enum(["completed", "needs_approval", "refused"]),
  // completed/refused: the answer. needs_approval: the assistant's explanation of what it wants to do.
  text: z.string(),
  // Populated only when status === "needs_approval": the action(s) awaiting a human tap.
  pending: z.array(z.object({ toolUseId: z.string(), tool: z.string(), argsJson: z.string() })),
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
      pending: result.pending.map((p) => ({ toolUseId: p.toolUseId, tool: p.tool, argsJson: JSON.stringify(p.input) })),
      transcript,
      usage: result.usage,
    };
  }
  return { status: result.status, text: result.text, pending: [], transcript, usage: result.usage };
};

export const createAiRouter = () =>
  router({
    // Start a fresh agent turn from a user instruction.
    run: ownerOrOfficeNoTx
      .input(z.object({ message: z.string().min(1) }))
      .output(runOutput)
      .mutation(async ({ ctx, input }) => {
        return toOutput(await drive(ctx, { userMessage: input.message }));
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
          const parsed = JSON.parse(input.transcript);
          if (!Array.isArray(parsed)) throw new Error("not an array");
          priorMessages = parsed as AgentMessage[];
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalid transcript" });
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
const drive = (
  ctx: { principal: Principal; deps: AppDeps },
  turn: { userMessage?: string; priorMessages?: AgentMessage[]; approvedToolUseIds?: string[]; deniedToolUseIds?: string[] },
): Promise<AgentResult> => {
  if (!ctx.deps.llmClient) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "the AI assistant is not enabled (ANTHROPIC_API_KEY unset)" });
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
      return tool.handle(input, { tx, orgId: ctx.principal.orgId, principal: ctx.principal, deps });
    });
  };
  return runAgentTurn({
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
};
