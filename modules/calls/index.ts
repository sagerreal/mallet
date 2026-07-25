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
export { PlaceOutboundCallUseCase } from "./app/place-outbound-call";
export { ApplyCallStatusUseCase } from "./app/apply-call-status";
export { LogCallOutcomeUseCase } from "./app/log-call-outcome";
export { DrizzleOutboundCallRepository } from "./infra/drizzle-outbound-call-repository";
export {
  DrizzleLeadPhoneReader,
  DrizzleOrgLineReader,
  DrizzleAgentNumberStore,
  DrizzleOrgByCallSidReader,
  DrizzleOrgByCallIdReader,
} from "./infra/drizzle-call-directory";
export { TwilioCallOriginator, type CallTransport } from "./infra/twilio-call-originator";
