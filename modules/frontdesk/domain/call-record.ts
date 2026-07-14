import type { OrgId, LeadId, CursorPage } from "@mallet/shared/types";

// How a completed call is classified at record time, derived from its tool invocations.
// Precedence (highest → lowest) is applied in deriveDisposition (app/disposition.ts), not here:
//   emergency > booked_estimate > booked_job > quote_request > message > no_action.
export type CallDisposition =
  | "booked_job"
  | "booked_estimate"
  | "quote_request"
  | "message"
  | "emergency"
  | "screened"
  | "no_action";

// One transcript turn as Vapi reports it in artifact.messages. `message` is nullable because
// some system/tool turns carry no spoken text. Kept structural (not a domain object) — it is
// opaque payload we store verbatim, never business logic.
export interface CallMessage {
  readonly role: string;
  readonly message: string | null;
}

// Result of the deterministic post-call price audit. `flagged` holds every spoken dollar
// amount that was NOT in the allowed set (serviceFee + flat prices). Non-empty ⇒ violation.
export interface PriceAudit {
  readonly flagged: readonly string[];
}

// Full end-of-call persistence input. All fields are what Vapi's end-of-call-report provides
// (nullable where Vapi may omit them) plus the derived disposition and price audit. orgId and
// leadId identify the tenant + matched caller; the repository stamps orgId on the row.
export interface RecordCallInput {
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly vapiCallId: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly endedReason: string | null;
  readonly transcript: string | null;
  readonly messages: readonly CallMessage[] | null;
  readonly recordingUrl: string | null;
  readonly summary: string | null;
  readonly disposition: CallDisposition;
  readonly priceAudit: PriceAudit | null;
}

// Skeleton-row input written on assistant-request, before the call has any content. The
// end-of-call-report later fills the same row (matched by orgId + vapiCallId).
export interface StartCallInput {
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly vapiCallId: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly startedAt: Date | null;
}

// DTO for the office-facing call list (PR C). Deliberately flat and separate from any domain
// notion of a call: `priceFlagged` collapses the price audit to a boolean the UI can chip on.
export interface CallSummary {
  readonly id: string;
  readonly when: Date;
  readonly fromNumber: string;
  readonly disposition: CallDisposition;
  readonly summary: string | null;
  readonly transcript: string | null;
  readonly recordingUrl: string | null;
  readonly priceFlagged: boolean;
}

// Persistence port for front-desk calls. All implementations are org-scoped (constructed with
// a tenant tx + orgId); the org boundary is enforced by RLS and reasserted with explicit
// eq(orgId) in the repository.
export interface FrontdeskCallRepository {
  // Upsert a skeleton row on assistant-request. ON CONFLICT (org_id, vapi_call_id) DO NOTHING —
  // a Vapi retry of assistant-request must not clobber an in-progress row.
  upsertInboundStart(input: StartCallInput): Promise<void>;
  // Persist the end-of-call-report. Updates the skeleton row matched by (org_id, vapi_call_id)
  // if present, else inserts — idempotent on the unique index.
  recordEndOfCall(input: RecordCallInput): Promise<void>;
  // Whether the stored call row was ALREADY price-flagged before this end-of-call write. recordEnd
  // OfCall is an idempotent upsert, but CreateTask is NOT — a Vapi end-of-call retry would otherwise
  // file a duplicate price-review task. The use-case reads this BEFORE persisting and only files the
  // review task when the prior row was not already flagged (a fresh violation). Returns false when
  // no row exists yet (first record) or its priceAudit was empty.
  wasPriceFlagged(vapiCallId: string): Promise<boolean>;
  // Office surfaces (PR C). Newest-first, non-deleted, scoped to the current org.
  listByLead(leadId: LeadId): Promise<CallSummary[]>;
  listRecent(page: CursorPage): Promise<CallSummary[]>;
}

// Idempotency ledger for voice tool calls. Vapi retries tool webhooks; a replayed toolCallId
// must return the stored result and never re-execute (double-booking guard). Keyed by the PK
// (org_id, tool_call_id); find() keys on toolCallId ALONE (org comes from the tx) so it exactly
// matches what save() writes — a superset filter (adding vapiCallId) could miss a legitimately
// saved row if the vapiCallId ever differed between save and replay.
export interface ToolInvocationLedger {
  find(toolCallId: string): Promise<{ result: unknown } | null>;
  save(input: {
    orgId: OrgId;
    vapiCallId: string;
    toolCallId: string;
    tool: string;
    result: unknown;
  }): Promise<void>;
  // All tool rows for one call, org-scoped. RecordCallUseCase reads these to derive the call's
  // disposition (which tools actually ran + their result data, e.g. an emergency flag). Order is
  // not significant — disposition is computed by precedence, not sequence.
  listByCall(vapiCallId: string): Promise<{ tool: string; result: unknown }[]>;
}
