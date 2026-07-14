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
const callSchema = z
  .object({
    id: z.string(),
    customer: z.object({ number: z.string().optional() }).passthrough().optional(),
    phoneNumber: z.object({ number: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

// Top-level phoneNumber echo (the org's provisioned number). Preferred over the nested call copy.
const phoneNumberSchema = z.object({ number: z.string().optional() }).passthrough();

// ── Phone-extraction helpers (pure) ───────────────────────────────────────────
// Exported so the route/tests can pull numbers without re-parsing the whole envelope.

interface OrgNumberSource {
  readonly phoneNumber?: { readonly number?: string };
  readonly call?: { readonly phoneNumber?: { readonly number?: string } };
}

// The org's provisioned number (the To). Prefer the top-level echo; fall back to the per-call copy.
export const extractOrgNumber = (message: OrgNumberSource): string | null =>
  message.phoneNumber?.number ?? message.call?.phoneNumber?.number ?? null;

interface CallerNumberSource {
  readonly call?: { readonly customer?: { readonly number?: string } };
}

// The caller's number (the From) — always on the customer object of the call.
export const extractCallerNumber = (message: CallerNumberSource): string | null =>
  message.call?.customer?.number ?? null;

// ── Per-type message schemas (validate only what we read) ─────────────────────

const assistantRequestSchema = z
  .object({
    type: z.literal("assistant-request"),
    call: callSchema,
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
  readonly callId: string;
  readonly callerNumber: string | null;
  readonly orgNumber: string | null;
}

export interface ParsedToolCalls {
  readonly type: "tool-calls";
  readonly callId: string;
  readonly toolCalls: readonly ParsedToolCall[];
}

export interface ParsedEndOfCallReport {
  readonly type: "end-of-call-report";
  readonly callId: string;
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
    case "assistant-request": {
      const parsed = assistantRequestSchema.safeParse(message);
      if (!parsed.success) return err(fieldError("assistant-request", parsed.error));
      return ok({
        type: "assistant-request",
        callId: parsed.data.call.id,
        callerNumber: extractCallerNumber(parsed.data),
        orgNumber: extractOrgNumber(parsed.data),
      });
    }
    case "tool-calls": {
      const parsed = toolCallsSchema.safeParse(message);
      if (!parsed.success) return err(fieldError("tool-calls", parsed.error));
      return ok({
        type: "tool-calls",
        callId: parsed.data.call.id,
        toolCalls: parsed.data.toolCallList.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: normalizeToolArguments(tc.arguments),
        })),
      });
    }
    case "end-of-call-report": {
      const parsed = endOfCallReportSchema.safeParse(message);
      if (!parsed.success) return err(fieldError("end-of-call-report", parsed.error));
      const messages = parsed.data.artifact?.messages?.map((m) => ({
        role: m.role,
        message: m.message,
      }));
      return ok({
        type: "end-of-call-report",
        callId: parsed.data.call.id,
        endedReason: parsed.data.endedReason,
        startedAt: parsed.data.startedAt,
        endedAt: parsed.data.endedAt,
        transcript: parsed.data.artifact?.transcript,
        messages,
        recordingUrl: recordingUrlFrom(parsed.data.artifact),
      });
    }
    case "status-update": {
      const parsed = statusUpdateSchema.safeParse(message);
      if (!parsed.success) return err(fieldError("status-update", parsed.error));
      return ok({
        type: "status-update",
        status: parsed.data.status,
        callId: parsed.data.call.id,
      });
    }
    default:
      return ok({ type: "unknown", rawType: message.type });
  }
};

const fieldError = (type: string, error: z.ZodError): string =>
  `invalid ${type} payload: ${error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}`;
