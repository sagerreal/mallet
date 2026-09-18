// Public surface for the frontdesk module — the composition seam the webhook route imports from.
// Only the pieces the route (or later PRs' composition) needs are re-exported here; internals
// (pure prompt helpers, mappers) stay private. The route may also import concrete infra classes
// directly, exactly like the Twilio webhook does — this barrel just keeps the common surface in
// one place. NOTE: never import this barrel from a unit test (it transitively pulls infra +
// config; house gotcha) — unit tests import the specific file under test.

// ── Domain ports + types ──────────────────────────────────────────────────────
export type {
  FrontdeskCallRepository,
  ToolInvocationLedger,
  RecordCallInput,
  StartCallInput,
  CallSummary,
  CallDisposition,
  CallMessage,
  PriceAudit,
} from "./domain/call-record";
export type {
  VapiAssistantDTO,
  VoiceToolSpec,
  SettingsReader,
  LeadSummaryReader,
  CallerContext,
} from "./domain/assistant";
export type { AvailabilityReader, AvailabilitySnapshot } from "./domain/availability";
export type { Geocoder, GeoPoint } from "./domain/geocoder";

// ── Application use-cases ───────────────────────────────────────────────────────
export { BuildAssistantUseCase } from "./app/build-assistant";
export type { BuildAssistantCmd, BuildAssistantDeps } from "./app/build-assistant";
export { RunToolCallsUseCase } from "./app/run-tool-calls";
export type {
  RunToolCallsInput,
  RunToolCallsBaseContext,
  VoiceToolDepsFactory,
} from "./app/run-tool-calls";
export { RecordCallUseCase } from "./app/record-call";
export type { RecordCallCmd, RecordCallDeps } from "./app/record-call";
export { deriveDisposition } from "./app/disposition";
export { auditPrices } from "./app/price-audit";
export { haversineMiles, isInServiceArea, EARTH_RADIUS_MI } from "./app/service-area";
export type { AreaCheck, ServiceAreaResult } from "./app/service-area";

// ── Tools ───────────────────────────────────────────────────────────────────────
export { takeMessageTool } from "./app/tools/take-message";
export { checkAvailabilityTool } from "./app/tools/check-availability";
export { bookVisitTool } from "./app/tools/book-visit";
export { requestQuoteTool } from "./app/tools/request-quote";
export { escalateCallbackTool } from "./app/tools/escalate-callback";
export { toVoiceToolSpec } from "./app/tools/tool-result";
export type {
  VoiceTool,
  VoiceToolContext,
  VoiceToolDeps,
  VoiceToolResult,
} from "./app/tools/tool-result";

// ── Infra (concrete adapters the route composes) ────────────────────────────────
export { DrizzleFrontdeskCallRepository } from "./infra/drizzle-call-repository";
export { DrizzleToolInvocationLedger } from "./infra/drizzle-tool-ledger";
export { DrizzleSettingsReader } from "./infra/drizzle-settings-reader";
export { DrizzlePricebookPriceReader } from "./infra/drizzle-pricebook-price-reader";
export { resolveBookingPrices } from "./domain/pricebook-price-reader";
export type { PricebookPriceReader } from "./domain/pricebook-price-reader";
export { DrizzleLeadSummaryReader } from "./infra/drizzle-lead-summary-reader";
export { DrizzleAvailabilityReader } from "./infra/drizzle-availability-reader";
export { CensusGeocoder } from "./infra/census-geocoder";

// ── Composition helpers the route uses ──────────────────────────────────────────
export { voicePrincipal, VOICE_PRINCIPAL_USER_ID } from "./app/voice-principal";
export { verifyVapiSecret } from "./infra/verify-secret";

// ── Boundary parsing (Vapi server messages) ─────────────────────────────────────
export { parseServerMessage } from "./infra/vapi-schemas";
export type {
  ParsedServerMessage,
  ParsedAssistantRequest,
  ParsedToolCalls,
  ParsedEndOfCallReport,
  ParsedStatusUpdate,
} from "./infra/vapi-schemas";

// ── Crew schedule write path (2.2b-i) ─────────────────────────────────────────
export { createFrontdeskRouter } from "./api/frontdesk-router";
export type { CrewScheduleRepository } from "./domain/crew-schedule-repository";
export { CrewScheduleEntry } from "./domain/crew-schedule";
export { SetCrewScheduleUseCase } from "./app/set-crew-schedule";
export { DrizzleCrewScheduleRepository } from "./infra/drizzle-crew-schedule-repository";
// Who the front desk may put an urgent caller through to, and when.
export { DrizzleOnCallReader } from "./infra/drizzle-on-call-reader";
export { pickOnCall } from "./domain/on-call";
export type { OnCallReader, OnCallCandidate } from "./domain/on-call";
