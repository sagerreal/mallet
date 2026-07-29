// Public surface for the a2p module — the only sanctioned import seam.
export { createA2pRouter } from "./api/a2p-router";

export { A2pRegistration, brandKind } from "./domain/registration";
export type { A2pStatus, BusinessInfo, A2pRegistrationProps } from "./domain/registration";
export type { RegistrationRepository, OrgBySidReader } from "./domain/registration-repository";
export type { A2pGateway, RemoteStatus, CampaignContent } from "./domain/a2p-gateway";

export { BeginA2pRegistrationUseCase } from "./app/begin-registration";
export type { A2pTenantRunner } from "./app/begin-registration";
export { AdvanceA2pRegistrationUseCase } from "./app/advance-registration";
export { GetA2pStatusUseCase } from "./app/get-status";
export type { A2pStatusView } from "./app/get-status";
export { isSmsA2pActive } from "./app/is-sms-active";
export { buildConsentDescription, buildOptInMessage, buildSampleMessages } from "./app/generate-consent";

export { DrizzleRegistrationRepository, DrizzleOrgBySidReader } from "./infra/drizzle-registration-repository";
export { TwilioA2pGateway, LoggingA2pGateway, A2P_CAMPAIGN_USECASE } from "./infra/twilio-a2p-gateway";
export type { A2pOps } from "./infra/twilio-a2p-gateway";

export {
  businessInfoDTO,
  a2pStatusDTO,
  a2pStatusViewDTO,
  submitResultDTO,
  toBusinessInfo,
  previewConsentInputDTO,
  consentPreviewDTO,
} from "./api/a2p-dto";
// Buying a shop its business line at signup. Separate from the A2P registration flow above: a
// number works for VOICE the day it is bought, while texting waits on carrier vetting.
export { ProvisionOrgNumberUseCase } from "./app/provision-org-number";
export type { ProvisionOrgNumberCommand, ProvisionOutcome } from "./app/provision-org-number";
export { TwilioNumberProvisioner } from "./infra/twilio-number-provisioner";
export type { NumberProvisioner, ProvisionedNumber } from "./domain/number-provisioner";
export { VapiVoiceRegistrar } from "./infra/vapi-voice-registrar";
export type { VoiceRegistrar } from "./domain/voice-registrar";
