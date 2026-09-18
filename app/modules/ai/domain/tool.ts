import type { z } from "zod";
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

// Sentinel a `fingerprint` returns when the referenced entity does not exist (or can't be read under
// the tenant's RLS). Distinct from a null fingerprint (a tool that declares no fingerprint). The
// confirm gate treats it as "no entity to act on" — a missing entity is refused at PROPOSE time
// rather than minting a token that could only ever fail at confirm. Printable + prefixed so it can
// never collide with a real fingerprint like `lead:<id>:<name>:<stage>`.
export const ENTITY_NOT_FOUND = "__entity_not_found__";

/**
 * What kind of damage a tool can do, and therefore what it takes to run it unattended.
 *
 * REQUIRED on every AgentTool, with no default, so a new tool without one is a compile error —
 * `pnpm typecheck` runs in CI and the tool-surface integration test does not.
 *
 * `destructive` covers more than deletion: customer_update can change an email, a phone number
 * and a service address, which redirects priced documents and payment links. That is a
 * delivery-redirection primitive, so it lives here and never auto-approves.
 */
export type RiskTier = "comms" | "operational" | "money" | "destructive";

// A tool = the model-facing spec (name/description/JSON-schema — MCP-shaped) + a `mutating` flag that
// drives human-approval gating + a handler that runs under a tenant tx. Read tools run unattended;
// mutating tools (send money/messages, dispatch) pause for approval before the handler ever runs.
// `input` is the zod source of `inputSchema` — the propose→confirm gate validates against it BOTH at
// proposal time and again at confirm (so a schema tightened between the two still applies).
// `fingerprint` (mutating tools) snapshots the referenced entity's relevant state; the confirm gate
// re-computes it and refuses to execute if the entity changed since the human saw the proposal.
// `enrichArgs` (optional, mutating tools only) runs at PROPOSE time AFTER zod validation, before the
// args are frozen into storage. Use it to inject server-minted values (e.g. idempotency keys) that
// must not come from the model. The returned object replaces the frozen args, so the confirm leg
// re-parses and executes the same enriched value — no second mint, no double-action.
export interface AgentTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly input: z.ZodType;
  readonly mutating: boolean;
  readonly riskTier: RiskTier;
  enrichArgs?(validated: Record<string, unknown>, ctx: ToolContext): Record<string, unknown>;
  fingerprint?(input: unknown, ctx: ToolContext): Promise<string>;
  handle(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}
