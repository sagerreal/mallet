import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import type { JsonValue } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";
import type { AgentTool, ToolContext } from "../domain/tool";
import { describeProposal } from "../domain/proposal-summary";
import { createProposal, consumeProposal, CONFIRMATION_TTL_MS } from "../infra/confirmation-store";

// The server-enforced propose→confirm gate for MUTATING tools on the remote MCP surface (ADR 0007).
// A raw MCP host is its own loop and may auto-approve, and MCP annotations are untrusted hints — so
// the server itself makes every mutation a two-step: the first call freezes the args + entity state
// and returns a one-time token; only a second call presenting that token executes, and it executes
// the FROZEN args against UNCHANGED entity state. This is deliberately not claimed to be a hard
// human gate (an autonomous host can echo the token back): it guarantees no one-shot mutation, a
// reviewable summary in the conversation, exact what-you-saw-is-what-runs args, and an audit row.

export type McpDeps = Pick<AppDeps, "clock" | "ids" | "notificationSender" | "paymentLinkGateway">;

export const buildToolContext = (tx: TenantTx, principal: Principal, deps: McpDeps): ToolContext => ({
  tx,
  orgId: principal.orgId,
  principal,
  deps: {
    bus: new OutboxEventBus(tx, principal.orgId),
    clock: deps.clock,
    ids: deps.ids,
    notificationSender: deps.notificationSender,
    paymentLinkGateway: deps.paymentLinkGateway,
  },
});

const text = (t: string, isError?: boolean): CallToolResult =>
  isError ? { content: [{ type: "text", text: t }], isError: true } : { content: [{ type: "text", text: t }] };

const invalidInput = (tool: string, issues: readonly { path: PropertyKey[]; message: string }[]): CallToolResult =>
  text(`invalid input for ${tool}: ${issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`, true);

// First leg: validate, snapshot entity state, freeze args, mint the one-time token. Returns a
// NORMAL (non-error) result — hosts are known to swallow or auto-retry isError results, and this is
// not an error: it is the expected first step. The text states unambiguously that nothing ran.
const propose = async (tool: AgentTool, args: Record<string, JsonValue>, principal: Principal, deps: McpDeps): Promise<CallToolResult> =>
  withTenant(principal.orgId, async (tx) => {
    const parsed = tool.input.safeParse(args);
    if (!parsed.success) return invalidInput(tool.name, parsed.error.issues);

    const ctx = buildToolContext(tx, principal, deps);
    const fingerprint = tool.fingerprint ? await tool.fingerprint(parsed.data, ctx) : null;
    const summary = describeProposal(tool.name, args);
    const proposal = await createProposal(tx, {
      orgId: principal.orgId,
      tool: tool.name,
      args,
      summary,
      fingerprint,
      createdBy: principal.userId,
      now: deps.clock.now(),
    });
    if (!proposal.ok) {
      return text(`too many pending proposals for this key — confirm or let them expire (${CONFIRMATION_TTL_MS / 60_000} minutes), then retry`, true);
    }
    return text(
      [
        `NO ACTION TAKEN — confirmation required before ${tool.name} executes.`,
        `Proposal: ${summary}`,
        `Show this proposal to the user and get their approval. To execute it, call ${tool.name} again with {"confirmToken": "${proposal.token}"}.`,
        `The token is single-use, expires ${proposal.expiresAt.toISOString()}, and executes exactly the proposed arguments above (arguments sent with the confirm call are ignored).`,
      ].join("\n"),
    );
  });

// Second leg: atomically consume the token, then re-validate the frozen args against the CURRENT
// schema and re-check the entity fingerprint — a proposal whose world moved on refuses to execute
// (and stays consumed: stale approvals don't get retries). Consume + execute share one tx, so an
// unexpected throw rolls the consume back (transient failures are retryable), while a clean refusal
// commits it.
const confirm = async (tool: AgentTool, rawToken: string, principal: Principal, deps: McpDeps): Promise<CallToolResult> =>
  withTenant(principal.orgId, async (tx) => {
    const consumed = await consumeProposal(tx, { rawToken, tool: tool.name, createdBy: principal.userId, now: deps.clock.now() });
    if (!consumed) return text("invalid or expired confirmation token — call the tool again without confirmToken to get a fresh proposal", true);

    const parsed = tool.input.safeParse(consumed.args);
    if (!parsed.success) return invalidInput(tool.name, parsed.error.issues);

    const ctx = buildToolContext(tx, principal, deps);
    const current = tool.fingerprint ? await tool.fingerprint(parsed.data, ctx) : null;
    if (current !== consumed.fingerprint) {
      return text("the record in this proposal changed after it was proposed — review the current state and propose again", true);
    }

    const outcome = await tool.handle(consumed.args, ctx);
    return outcome.ok ? text(outcome.summary) : text(outcome.error, true);
  });

// Entry point for a mutating tools/call. confirmToken is transport-level (stripped before the
// business args are validated/frozen); its presence selects the leg.
export const handleMutatingCall = async (
  tool: AgentTool,
  rawArgs: Record<string, unknown>,
  principal: Principal,
  deps: McpDeps,
): Promise<CallToolResult> => {
  const { confirmToken, ...rest } = rawArgs;
  // Arrived via JSON-RPC, so values are JSON-safe by construction.
  const args = rest as Record<string, JsonValue>;
  if (confirmToken !== undefined && typeof confirmToken !== "string") {
    return text("confirmToken must be a string", true);
  }
  return confirmToken ? confirm(tool, confirmToken, principal, deps) : propose(tool, args, principal, deps);
};
