import { loadConfig } from "@mallet/shared/config";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { uuidGenerator } from "@mallet/shared/ports";
import { systemClock, type OrgId } from "@mallet/shared/types";
import { OutboxEventBus } from "@mallet/shared/outbox";
import {
  DrizzleOrgByNumberReader,
  DrizzleLeadByPhoneReader,
  DrizzleLeadUnreadMarker,
} from "@mallet/messaging";
import { EnsureCustomerUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { CreateTaskUseCase, DrizzleTaskRepository } from "@mallet/tasks";
import { CreateManualJobUseCase, CreateVisitUseCase, DrizzleJobRepository } from "@mallet/jobs";
import { getAppDeps } from "@/trpc/di";
import {
  parseServerMessage,
  BuildAssistantUseCase,
  RunToolCallsUseCase,
  RecordCallUseCase,
  DrizzleFrontdeskCallRepository,
  DrizzleToolInvocationLedger,
  DrizzleSettingsReader,
  DrizzleLeadSummaryReader,
  DrizzleAvailabilityReader,
  takeMessageTool,
  checkAvailabilityTool,
  bookVisitTool,
  toVoiceToolSpec,
  voicePrincipal,
  verifyVapiSecret,
  type ParsedAssistantRequest,
  type ParsedToolCalls,
  type ParsedEndOfCallReport,
  type VoiceTool,
  type VoiceToolDeps,
} from "@mallet/frontdesk";

// Vapi voice front-desk webhook — a plain Next route (NOT tRPC). Vapi POSTs server messages here:
// assistant-request (return the per-call assistant config), tool-calls (run a voice tool),
// end-of-call-report (persist the call), status-update / unknown (log + ack). It mirrors the
// Twilio webhook exactly: config-gate → RAW body once → secret verify FIRST → org by To-number
// (privileged, no tenant yet) → all tenant work inside withTenant so a throw rolls back.
//
// SECURITY: the shared secret arrives as the `x-vapi-secret` header. We compare it TIMING-SAFELY
// before any parse or DB access — an unverified endpoint would let anyone drive the voice agent
// or inject fake calls. Unset secret → 503 (feature dark, fail-closed).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The voice tool whitelist. The whitelist IS the guardrail (a live call cannot pause for approval)
// — only these tools can ever run. PR B adds check_availability + book_visit; the rest follow.
const VOICE_TOOLS: readonly VoiceTool[] = [takeMessageTool, checkAvailabilityTool, bookVisitTool];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();

  // (a) Feature dark unless the shared secret is configured. 503 so Vapi treats it as unavailable.
  if (!config.VAPI_WEBHOOK_SECRET) {
    logger.warn({ path: "frontdesk/vapi" }, "vapi webhook: VAPI_WEBHOOK_SECRET unset — feature dark");
    return new Response("vapi not configured", { status: 503 });
  }

  // (b) Read the raw body once (stream is single-use), then verify the secret BEFORE any parse/DB.
  const rawBody = await req.text();
  if (!verifyVapiSecret(req.headers.get("x-vapi-secret"), config.VAPI_WEBHOOK_SECRET)) {
    logger.warn({ path: "frontdesk/vapi" }, "vapi webhook rejected: invalid secret");
    return new Response("invalid secret", { status: 401 });
  }

  // (c) Parse the JSON body then validate the server-message envelope. A parse/validation failure
  //     is a 400 (bad payload) — logged, never a crash.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    logger.warn({ path: "frontdesk/vapi" }, "vapi webhook: body is not valid JSON");
    return new Response("invalid json", { status: 400 });
  }
  const parsed = parseServerMessage(body);
  if (!parsed.ok) {
    logger.warn({ path: "frontdesk/vapi", error: parsed.error }, "vapi webhook: invalid payload");
    return new Response("invalid payload", { status: 400 });
  }
  const message = parsed.value;

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    // status-update / unknown carry no org-routing need — log + 200 ack (Vapi sends types we skip).
    if (message.type === "status-update" || message.type === "unknown") {
      logger.info({ type: message.type }, "vapi webhook: acked (no-op message type)");
      return json({});
    }

    // (d) Org id ONLY from the To-number lookup (privileged, BYPASSRLS — no tenant yet). Unknown
    //     number never 5xxs: assistant-request gets a minimal decline assistant, everything else
    //     is acked.
    const orgNumber = orgNumberOf(message);
    const orgReader = new DrizzleOrgByNumberReader();
    const orgId = orgNumber ? await orgReader.findOrgIdByTwilioNumber(orgNumber) : null;

    if (!orgId) {
      logger.warn({ type: message.type, orgNumber }, "vapi webhook: no org for To-number");
      return message.type === "assistant-request" ? json({ assistant: unknownOrgAssistant() }) : json({});
    }

    enrichRequestContext({ orgId });

    // (e) All tenant work inside withTenant. We do NOT catch inside the tx — a throw rolls the tx
    //     back and propagates to the outer catch, which 5xxs so Vapi retries (the ledger + unique
    //     index absorb the replay).
    try {
      return await withTenant(orgId, (tx) => dispatch(message, orgId, tx));
    } catch (error: unknown) {
      logger.error(
        {
          type: message.type,
          orgId,
          vapiCallId: callIdOf(message),
          err: error instanceof Error ? error.message : String(error),
        },
        "vapi webhook processing failed",
      );
      return new Response("processing error", { status: 500 });
    }
  });
}

// Dispatch one verified, org-resolved server message inside the tenant tx.
const dispatch = async (
  message: ParsedAssistantRequest | ParsedToolCalls | ParsedEndOfCallReport,
  orgId: OrgId,
  tx: TenantTx,
): Promise<Response> => {
  switch (message.type) {
    case "assistant-request":
      return handleAssistantRequest(message, orgId, tx);
    case "tool-calls":
      return handleToolCalls(message, orgId, tx);
    case "end-of-call-report":
      return handleEndOfCall(message, orgId, tx);
  }
};

// assistant-request → build the transient assistant from the org playbook, seed a skeleton call
// row (only when we have a callId), respond `{ assistant }` (Vapi wraps the config under this key).
const handleAssistantRequest = async (
  message: ParsedAssistantRequest,
  orgId: OrgId,
  tx: TenantTx,
): Promise<Response> => {
  const builder = new BuildAssistantUseCase(
    {
      settings: new DrizzleSettingsReader(tx, orgId),
      leadByPhone: new DrizzleLeadByPhoneReader(tx, orgId),
      leadSummary: new DrizzleLeadSummaryReader(tx, orgId),
    },
    VOICE_TOOLS.map(toVoiceToolSpec),
  );
  const result = await builder.exec({ orgId, fromNumber: message.callerNumber });
  if (!result.ok) {
    // No settings for a KNOWN org is a real processing error → 5xx (let Vapi retry).
    logger.error({ orgId, error: result.error.message }, "vapi webhook: build assistant failed");
    throw new Error(result.error.message);
  }

  if (message.callId !== null) {
    const calls = new DrizzleFrontdeskCallRepository(tx, orgId);
    await calls.upsertInboundStart({
      orgId,
      leadId: null,
      vapiCallId: message.callId,
      fromNumber: message.callerNumber ?? "",
      toNumber: message.orgNumber ?? "",
      startedAt: systemClock.now(),
    });
  }

  logger.info(
    { type: "assistant-request", orgId, vapiCallId: message.callId },
    "vapi webhook: assistant returned",
  );
  return json({ assistant: result.value });
};

// tool-calls → run the voice tools idempotently, respond `{ results }`.
const handleToolCalls = async (
  message: ParsedToolCalls,
  orgId: OrgId,
  tx: TenantTx,
): Promise<Response> => {
  const ledger = new DrizzleToolInvocationLedger(tx, orgId);
  const runner = new RunToolCallsUseCase(VOICE_TOOLS, ledger, (base) =>
    buildVoiceToolDeps(base.tx, base.orgId),
  );
  const out = await runner.exec({
    vapiCallId: message.callId ?? "",
    toolCalls: message.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
    ctx: { tx, orgId, principal: voicePrincipal(orgId) },
  });
  logger.info(
    { type: "tool-calls", orgId, vapiCallId: message.callId, count: out.results.length },
    "vapi webhook: tool calls ran",
  );
  return json({ results: out.results });
};

// end-of-call-report → persist the call (disposition + price audit + lead match), respond `{}`.
const handleEndOfCall = async (
  message: ParsedEndOfCallReport,
  orgId: OrgId,
  tx: TenantTx,
): Promise<Response> => {
  const recorder = new RecordCallUseCase({
    calls: new DrizzleFrontdeskCallRepository(tx, orgId),
    ledger: new DrizzleToolInvocationLedger(tx, orgId),
    settings: new DrizzleSettingsReader(tx, orgId),
    leadByPhone: new DrizzleLeadByPhoneReader(tx, orgId),
    unreadMarker: new DrizzleLeadUnreadMarker(tx, orgId),
    createTask: buildCreateTask(tx, orgId),
    clock: systemClock,
  });
  await recorder.exec({
    orgId,
    vapiCallId: message.callId ?? "",
    fromNumber: message.callerNumber ?? "",
    toNumber: message.orgNumber ?? "",
    startedAt: parseDate(message.startedAt),
    endedAt: parseDate(message.endedAt),
    endedReason: message.endedReason ?? null,
    transcript: message.transcript ?? null,
    messages: message.messages ? message.messages.map((m) => ({ role: m.role, message: m.message ?? null })) : null,
    recordingUrl: message.recordingUrl,
    summary: null,
  });
  logger.info(
    { type: "end-of-call-report", orgId, vapiCallId: message.callId },
    "vapi webhook: call recorded",
  );
  return json({});
};

// ── Composition helpers ─────────────────────────────────────────────────────────

// Build the voice tools' dependencies from THIS call's tenant tx (mirrors ai-router drive()):
// an outbox-bound bus so a tool's emits are atomic with its writes, the two write use-cases, and
// the two query-only readers check_availability needs (org hours + open schedule). Every port is
// tenant-tx-scoped so nothing reaches drizzle outside withTenant.
const buildVoiceToolDeps = (tx: TenantTx, orgId: OrgId): VoiceToolDeps => {
  const bus = new OutboxEventBus(tx, orgId);
  // One tenant-scoped job repository shared by the two write use-cases book_visit drives: create the
  // manual job, then seed its first visit (the server-side caller does this itself — no client flow
  // follows a voice booking, per CreateManualJobUseCase's comment).
  const jobs = new DrizzleJobRepository(tx, orgId);
  return {
    ensureCustomer: new EnsureCustomerUseCase(new DrizzleLeadRepository(tx, orgId), bus, systemClock),
    createManualJob: new CreateManualJobUseCase(jobs, bus, systemClock, uuidGenerator),
    createVisit: new CreateVisitUseCase(jobs, systemClock, uuidGenerator),
    createTask: buildCreateTask(tx, orgId),
    settings: new DrizzleSettingsReader(tx, orgId),
    availability: new DrizzleAvailabilityReader(tx, orgId),
    bus,
    clock: systemClock,
    ids: uuidGenerator,
  };
};

const buildCreateTask = (tx: TenantTx, orgId: OrgId): CreateTaskUseCase =>
  new CreateTaskUseCase(new DrizzleTaskRepository(tx, orgId), systemClock, uuidGenerator);

// ── Pure extraction helpers ───────────────────────────────────────────────────

// All three org-scoped message types now carry the To (org) number off the message.
const orgNumberOf = (
  message: ParsedAssistantRequest | ParsedToolCalls | ParsedEndOfCallReport,
): string | null => message.orgNumber;

const callIdOf = (
  message: ParsedAssistantRequest | ParsedToolCalls | ParsedEndOfCallReport,
): string | null => message.callId;

const parseDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Minimal decline assistant for a call to a number we don't recognize — never leak that the number
// is unprovisioned; just greet + hang up. Kept inline (not the org decline) since we have no brand.
const unknownOrgAssistant = () => ({
  firstMessage: "Thanks for calling. This number isn't set up to take calls right now — goodbye.",
  model: { provider: "openai", model: "gpt-4o", temperature: 0, messages: [], tools: [] },
  voice: { provider: "vapi", voiceId: "Elliot" },
  maxDurationSeconds: 30,
  artifactPlan: { recordingEnabled: true },
  endCallFunctionEnabled: true,
});
