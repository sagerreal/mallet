import type { OrgId, Clock } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { NotificationSender } from "@mallet/notifications";
import type { PaymentLinkGateway } from "@mallet/invoicing";

// Dependencies a tool handler may need, injected per call. `bus` is an OutboxEventBus bound to THIS
// call's tenant tx (built by the runner), so a tool's emits are durable + atomic exactly like a tRPC
// request. Optional adapters are null when unconfigured (a tool needing one returns a clean error).
export interface ToolDeps {
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly notificationSender?: NotificationSender;
  readonly paymentLinkGateway: PaymentLinkGateway | null;
}

// The execution context for a tool call. tx is a SHORT tenant transaction opened just for this call
// (the loop never holds one open across model round-trips); orgId comes ONLY from the verified
// Principal, never from model-supplied input — the prompt-injection guard.
export interface ToolContext {
  readonly tx: TenantTx;
  readonly orgId: OrgId;
  readonly principal: Principal;
  readonly deps: ToolDeps;
}

// A natural-language outcome fed back to the model. Errors are actionable text (is_error) so the
// model can self-correct — never an opaque code or a raw provider/DB message (no PII).
export type ToolOutcome = { readonly ok: true; readonly summary: string } | { readonly ok: false; readonly error: string };

// A tool = the model-facing spec (name/description/JSON-schema — MCP-shaped) + a `mutating` flag that
// drives human-approval gating + a handler that runs under a tenant tx. Read tools run unattended;
// mutating tools (send money/messages, dispatch) pause for approval before the handler ever runs.
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly mutating: boolean;
  handle(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}
