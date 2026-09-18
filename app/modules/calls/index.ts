// Public surface for the calls module — the only sanctioned import seam.
// Outbound click-to-call. Inbound voice belongs to @mallet/frontdesk (Vapi); the two share
// no storage on purpose — an inbound AI call and an outbound two-leg bridge have different
// lifecycles and different columns.
export { createCallRouter } from "./api/call-router";
export { outboundCallDTO, toOutboundCallDTO, type OutboundCallDTO } from "./api/call-dto";
export type { OutboundCall, OutboundCallProps, OutboundCallStatus } from "./domain/outbound-call";
export type { OutboundCallRepository } from "./domain/outbound-call-repository";
export type { CallOriginator, OriginateCallCmd, CallOriginationReceipt } from "./domain/call-originator";
export type { LeadPhoneReader, OrgLineReader, AgentNumberStore } from "./domain/call-directory";
export type { VoiceTokenIssuer, VoiceAccessToken } from "./domain/voice-token-issuer";
export type { CallTransport } from "./domain/outbound-call";
export { CALL_TRANSPORTS, isCallTransport } from "./domain/outbound-call";
export { PlaceOutboundCallUseCase } from "./app/place-outbound-call";
export { ApplyCallStatusUseCase } from "./app/apply-call-status";
export { LogCallOutcomeUseCase } from "./app/log-call-outcome";
export { GetOutboundCallUseCase } from "./app/get-outbound-call";
export { SetCallbackNumberUseCase } from "./app/set-callback-number";
export { DrizzleOutboundCallRepository } from "./infra/drizzle-outbound-call-repository";
export {
  DrizzleLeadPhoneReader,
  DrizzleOrgLineReader,
  DrizzleAgentNumberStore,
  DrizzleOrgByCallSidReader,
  DrizzleOrgByCallIdReader,
} from "./infra/drizzle-call-directory";
export { TwilioCallOriginator, type CallHttpTransport } from "./infra/twilio-call-originator";
export { TwilioVoiceTokenIssuer } from "./infra/twilio-voice-token-issuer";
