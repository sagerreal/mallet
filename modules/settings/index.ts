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
export { defaultBooking } from "./app/default-booking";
export { UpdateConfigUseCase } from "./app/update-config";
export { DrizzleSettingsRepository } from "./infra/drizzle-settings-repository";
export type { ConnectGateway, ConnectAccountStatus } from "./domain/connect-gateway";
export { StripeConnectGateway } from "./infra/stripe-connect-gateway";
export { BeginConnectOnboardingUseCase, RefreshConnectStatusUseCase } from "./app/connect-onboarding";
export type { ConnectStatusView } from "./app/connect-onboarding";
