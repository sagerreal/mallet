import { z } from "zod";
import { type Result, ok, err } from "@mallet/shared/types";

// Boundary validation for Vapi server messages (the webhook payload). Vapi's envelope is
// `{ message: { type, ... } }`; the platform adds fields freely and versions the schema without
// notice, so every object is `.passthrough()` and we validate ONLY the fields we actually read.
// Unrecognized `type` values are NOT errors — Vapi sends message types we don't handle (they get
// logged + 200-acked upstream). Truly malformed input (missing envelope, junk) is a typed failure,
// never a throw: a webhook handler must decide the HTTP status, not crash on parse.

// ── Shared leaf schemas ───────────────────────────────────────────────────────

// The call object. We read the id (correlation key) plus the caller (From) and, on some
// messages, a per-call phoneNumber echo used as a fallback for the org (To) number.
//
// customer/phoneNumber are `unknown`, NOT a strict object: Vapi populates these nested per-call
// copies with varying shapes — an object, a bare string, or an explicit `null` (which
// `z.object(...).optional()` REJECTS, since optional means undefined, not null). A single
// over-strict leaf here 400s EVERY message type, because they all embed callSchema. Per this
// file's own principle — validate only what we read — we keep them opaque and dig out `.number`
// safely in `numberOf` below.
const callSchema = z
  .object({
    id: z.string(),
    customer: z.unknown().optional(),
    phoneNumber: z.unknown().optional(),
  })
  .passthrough();

// Top-level phoneNumber echo (the org's provisioned number). Preferred over the nested call copy.
// Also `unknown` for the same reason — Vapi may send it as an object or null depending on the event.
const phoneNumberSchema = z.unknown();

// ── Phone-extraction helpers (pure) ───────────────────────────────────────────
// Exported so the route/tests can pull numbers without re-parsing the whole envelope.

// Safely read a `.number` string off a Vapi phone-ish field of unknown shape. Returns null for
// anything that isn't an object carrying a string `number` (a bare string, a null, undefined,
// an object without `number`) — Vapi sends all of these across events and versions.
const numberOf = (value: unknown): string | null => {
  if (value && typeof value === "object" && "number" in value) {
    const n = (value as { number?: unknown }).number;
    return typeof n === "string" ? n : null;
  }
  return null;
};

interface OrgNumberSource {
  readonly phoneNumber?: unknown;
  readonly call?: { readonly phoneNumber?: unknown };
}

// The org's provisioned number (the To). Prefer the top-level echo; fall back to the per-call copy.
export const extractOrgNumber = (message: OrgNumberSource): string | null =>
  numberOf(message.phoneNumber) ?? numberOf(message.call?.phoneNumber) ?? null;

interface CallerNumberSource {
  readonly call?: { readonly customer?: unknown };
}

// The caller's number (the From) — on the customer object of the call when present.
export const extractCallerNumber = (message: CallerNumberSource): string | null =>
  numberOf(message.call?.customer);

// ── Per-type message schemas (validate only what we read) ─────────────────────

// `call` is OPTIONAL here: Vapi can POST assistant-request BEFORE the call object is fully
// populated (A2-review carry). We still answer — the org is resolved from the top-level
// phoneNumber echo, and callId falls back to null (no skeleton row is written without an id).
const assistantRequestSchema = z
  .object({
    type: z.literal("assistant-request"),
    call: callSchema.optional(),
    phoneNumber: phoneNumberSchema.optional(),
  })
  .passthrough();

// A single tool invocation. `arguments` arrives as an object OR a JSON string depending on the
// model/provider; we keep it `unknown` here and normalize below so the tool runner sees an object.
const toolCallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    arguments: z.unknown(),
  })
  .passthrough();

const toolCallsSchema = z
  .object({
    type: z.literal("tool-calls"),
    call: callSchema,
    // The org's provisioned number can also echo at the top level on tool-calls (same as
    // assistant-request); we read it for tenant routing, falling back to the per-call copy.
    phoneNumber: phoneNumberSchema.optional(),
    toolCallList: z.array(toolCallSchema),
  })
  .passthrough();

// A transcript line. `message` (the text) is sometimes omitted (e.g. tool rows) — tolerate it.
const transcriptMessageSchema = z
  .object({ role: z.string(), message: z.string().optional() })
  .passthrough();

const endOfCallReportSchema = z
  .object({
    type: z.literal("end-of-call-report"),
    call: callSchema,
    endedReason: z.string().optional(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    artifact: z
      .object({
        transcript: z.string().optional(),
        messages: z.array(transcriptMessageSchema).optional(),
        recordingUrl: z.string().optional(),
        recording: z
          .object({ stereoUrl: z.string().optional(), url: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const statusUpdateSchema = z
  .object({
    type: z.literal("status-update"),
    status: z.string(),
    call: callSchema,
  })
  .passthrough();

// The outer envelope. We only require that `message.type` is a string here; the per-type schema
// then validates the fields specific to that message. Anything else is a typed failure.
const envelopeSchema = z
  .object({ message: z.object({ type: z.string() }).passthrough() })
  .passthrough();

// ── Parsed (normalized) shapes — the discriminated union the route consumes ───

export interface ParsedToolCall {
  readonly id: string;
  readonly name: string;
  // Normalized to an object where possible; left as the raw value (e.g. a malformed JSON string)
  // when it can't be parsed, so the downstream tool runner rejects it cleanly with a spoken fallback.
  readonly arguments: unknown;
}

export interface ParsedTranscriptMessage {
  readonly role: string;
  readonly message?: string;
}

export interface ParsedAssistantRequest {
  readonly type: "assistant-request";
  // Null when Vapi sends assistant-request before the call object is populated. The org is still
  // resolvable from orgNumber; the route simply skips the skeleton-row write when callId is null.
  readonly callId: string | null;
  readonly callerNumber: string | null;
  readonly orgNumber: string | null;
}

export interface ParsedToolCalls {
  readonly type: "tool-calls";
  readonly callId: string;
  // The To (org) number off the message, for tenant routing (same lookup as assistant-request).
  readonly orgNumber: string | null;
  readonly toolCalls: readonly ParsedToolCall[];
}

export interface ParsedEndOfCallReport {
  readonly type: "end-of-call-report";
  readonly callId: string;
  // The From (caller) and To (org) numbers off the report's call object. orgNumber routes the
  // report to the right tenant (same To-number lookup as assistant-request); callerNumber lets the
  // recorder re-resolve the lead. Both nullable — Vapi may omit them on some reports.
  readonly callerNumber: string | null;
  readonly orgNumber: string | null;
  readonly endedReason?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly transcript?: string;
  readonly messages?: readonly ParsedTranscriptMessage[];
  readonly recordingUrl: string | null;
}

export interface ParsedStatusUpdate {
  readonly type: "status-update";
  readonly status: string;
  readonly callId: string;
}

// Fallback for message types we don't handle. NOT a failure — the route logs + 200-acks it.
export interface ParsedUnknown {
  readonly type: "unknown";
  readonly rawType: string;
}

export type ParsedServerMessage =
  | ParsedAssistantRequest
  | ParsedToolCalls
  | ParsedEndOfCallReport
  | ParsedStatusUpdate
  | ParsedUnknown;

export type ParseServerMessageResult = Result<ParsedServerMessage, string>;

// ── Normalization helpers ─────────────────────────────────────────────────────

// Tool arguments may arrive as a JSON string; try to parse to an object. On any failure, return
// the raw value untouched so the tool runner surfaces a clean validation error (no silent drop).
const normalizeToolArguments = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

const recordingUrlFrom = (
  artifact: z.infer<typeof endOfCallReportSchema>["artifact"],
): string | null =>
  artifact?.recording?.stereoUrl ?? artifact?.recording?.url ?? artifact?.recordingUrl ?? null;

// ── Public parser ─────────────────────────────────────────────────────────────

// One parser per message type — each validates its own fields and normalizes to the parsed shape.
// Split out of parseServerMessage so the dispatcher stays a flat, low-complexity switch.

const parseAssistantRequest = (message: unknown): ParseServerMessageResult => {
  const parsed = assistantRequestSchema.safeParse(message);
  if (!parsed.success) return err(fieldError("assistant-request", parsed.error));
  return ok({
    type: "assistant-request",
    callId: parsed.data.call?.id ?? null,
    callerNumber: extractCallerNumber(parsed.data),
    orgNumber: extractOrgNumber(parsed.data),
  });
};

const parseToolCalls = (message: unknown): ParseServerMessageResult => {
  const parsed = toolCallsSchema.safeParse(message);
  if (!parsed.success) return err(fieldError("tool-calls", parsed.error));
  return ok({
    type: "tool-calls",
    callId: parsed.data.call.id,
    orgNumber: extractOrgNumber(parsed.data),
    toolCalls: parsed.data.toolCallList.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: normalizeToolArguments(tc.arguments),
    })),
  });
};

const parseEndOfCallReport = (message: unknown): ParseServerMessageResult => {
  const parsed = endOfCallReportSchema.safeParse(message);
  if (!parsed.success) return err(fieldError("end-of-call-report", parsed.error));
  const messages = parsed.data.artifact?.messages?.map((m) => ({ role: m.role, message: m.message }));
  return ok({
    type: "end-of-call-report",
    callId: parsed.data.call.id,
    callerNumber: extractCallerNumber(parsed.data),
    orgNumber: extractOrgNumber(parsed.data),
    endedReason: parsed.data.endedReason,
    startedAt: parsed.data.startedAt,
    endedAt: parsed.data.endedAt,
    transcript: parsed.data.artifact?.transcript,
    messages,
    recordingUrl: recordingUrlFrom(parsed.data.artifact),
  });
};

const parseStatusUpdate = (message: unknown): ParseServerMessageResult => {
  const parsed = statusUpdateSchema.safeParse(message);
  if (!parsed.success) return err(fieldError("status-update", parsed.error));
  return ok({ type: "status-update", status: parsed.data.status, callId: parsed.data.call.id });
};

// Parse + normalize a raw webhook body into a ParsedServerMessage. Never throws. Junk/missing
// envelope → typed failure; a recognized type that fails its own field validation → typed failure;
// an unrecognized type → a successful `{ type: "unknown" }`.
export const parseServerMessage = (body: unknown): ParseServerMessageResult => {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) {
    return err(`invalid vapi envelope: ${envelope.error.issues[0]?.message ?? "unknown"}`);
  }

  const message = envelope.data.message;
  switch (message.type) {
    case "assistant-request":
      return parseAssistantRequest(message);
    case "tool-calls":
      return parseToolCalls(message);
    case "end-of-call-report":
      return parseEndOfCallReport(message);
    case "status-update":
      return parseStatusUpdate(message);
    default:
      return ok({ type: "unknown", rawType: message.type });
  }
};

const fieldError = (type: string, error: z.ZodError): string =>
  `invalid ${type} payload: ${error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`;
