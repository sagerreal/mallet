import type { OrgId, Result, AppError } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";
import type { TenantTx } from "@mallet/shared/db/tx";

// A decoded outbox row handed to a handler. payload is the jsonb we stored (JSON-safe values only —
// dates are ISO strings). seq is the monotonic order; orgId is the tenant the event belongs to.
export interface OutboxEvent {
  readonly id: string;
  readonly seq: number;
  readonly orgId: OrgId;
  readonly name: string;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: Date;
}

// Handlers run UNDER withTenant(orgId) — the ctx.tx is the tenant transaction (RLS-scoped), so any
// DB work a handler does is tenant-scoped exactly like a request. Handlers MUST be idempotent: the
// relay is at-least-once (claim / dispatch / mark are separate txns), so the same event can be
// dispatched more than once.
export interface RelayHandlerContext {
  readonly tx: TenantTx;
  readonly orgId: OrgId;
}

// Disposition contract (see relay.ts): ok -> published; err with a RETRYABLE external_service (infra
// blip) -> left unpublished for the next tick; any other err (validation/not_found/conflict — a bad
// or un-processable event) -> published (terminal, don't spin attempts); a THROWN error -> retried.
export interface OutboxHandler {
  handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>>;
}

export type OutboxHandlerMap = ReadonlyMap<string, OutboxHandler>;
