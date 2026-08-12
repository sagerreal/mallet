// Public surface for the settings module — the only sanctioned import seam.
export { createSettingsRouter } from "./api/settings-router";
export { OrgSettings } from "./domain/org-settings";
export type { OrgSettingsProps, BookingCfg, BookingService, ServiceLane } from "./domain/org-settings";
export type {
  SettingsRepository,
  PricebookItem,
  LaborRate,
  LaborRateKind,
  JobTerm,
  LeadSource,
} from "./domain/settings-repository";
export { GetSettingsUseCase } from "./app/get-settings";
export type { SettingsSnapshot } from "./app/get-settings";
export { GetFieldTogglesUseCase } from "./app/get-field-toggles";
export type { FieldToggles } from "./app/get-field-toggles";
// The identity block every invoice document prints. Exported so invoicing's public (token-gated)
// page resolves it through the settings use-case rather than re-querying org_settings itself.
export { GetBusinessIdentityUseCase } from "./app/get-business-identity";
export type { BusinessIdentity } from "./app/get-business-identity";
// The document-wording overrides + the standard sentences and effective resolvers. Exported so
// invoicing's public (token-gated) page resolves wording through the settings module rather than
// re-querying org_settings itself, and so every render seam shares ONE fallback definition.
export { GetDocumentWordingUseCase } from "./app/get-document-wording";
export type { DocumentWording } from "./app/get-document-wording";
export {
  defaultPayInstructions,
  defaultReceiptNote,
  defaultChangeOrderAgreement,
  effectiveInvoiceFooter,
  effectivePayInstructions,
  effectiveReceiptNote,
  effectiveChangeOrderAgreement,
  INVOICE_FOOTER_MAX,
  PAY_INSTRUCTIONS_MAX,
  RECEIPT_NOTE_MAX,
  CHANGE_ORDER_AGREEMENT_MAX,
} from "./domain/document-wording";
export { defaultBooking } from "./app/default-booking";
export { UpdateConfigUseCase } from "./app/update-config";
export { DrizzleSettingsRepository } from "./infra/drizzle-settings-repository";
export type { ConnectGateway, ConnectAccountStatus } from "./domain/connect-gateway";
export { StripeConnectGateway } from "./infra/stripe-connect-gateway";
export { BeginConnectOnboardingUseCase, RefreshConnectStatusUseCase } from "./app/connect-onboarding";
export type { ConnectStatusView } from "./app/connect-onboarding";
export { frontDeskReadiness, type FrontDeskGap, type FrontDeskReadiness } from "./domain/front-desk-readiness";
