// Public surface for the accounting-sync module — the only import seam (architecture rule).
//
// Scope today: the QuickBooks Online CONNECTION (OAuth + sealed token lifecycle). The sync itself
// (pushing approved time entries as TimeActivity) lands in a later PR — see
// docs/superpowers/plans/2026-07-24-qbo-timesheet-sync.md.

export {
  QboConnection,
  ACCESS_TOKEN_SKEW_MS,
  type QboConnectionProps,
  type QboConnectionStatus,
  type RefreshedTokens,
} from "./domain/qbo-connection";
export type { QboConnectionRepository } from "./domain/qbo-connection-repository";
export type { QboOauthGateway, QboTokens } from "./domain/qbo-oauth-gateway";
export type {
  QboApiGateway,
  QboAccess,
  QboPerson,
  QboServiceItem,
  QboPreflight,
} from "./domain/qbo-api-gateway";
export type {
  QboEntityLink,
  QboEntityLinkRepository,
  QboSyncLogEntry,
  QboSyncLogRepository,
} from "./domain/qbo-sync-repositories";
export { toTimeActivity, type SyncableTimeEntry } from "./domain/time-activity-mapping";
export { signOauthState, verifyOauthState, type OauthStateClaims } from "./domain/oauth-state";

export { DrizzleQboConnectionRepository } from "./infra/drizzle-qbo-connection-repository";
export { HttpQboOauthGateway, type IntuitOauthConfig } from "./infra/http-qbo-oauth-gateway";
export { HttpQboApiGateway, type QboEnvironment } from "./infra/http-qbo-api-gateway";
export {
  DrizzleQboEntityLinkRepository,
  DrizzleQboSyncLogRepository,
} from "./infra/drizzle-qbo-sync-repositories";

export { EnsureFreshAccessToken, type FreshAccess } from "./app/ensure-fresh-access-token";
export {
  CompleteQboConnect,
  type CompleteQboConnectCommand,
  type TenantRunner,
} from "./app/complete-qbo-connect";
export { DisconnectQbo } from "./app/disconnect-qbo";
export { GetQboStatus, type QboStatus } from "./app/get-qbo-status";
export { SyncApprovedHours, type SyncApprovedHoursResult } from "./app/sync-approved-hours";
export { QboTimeSyncHandler, type QboTimeSyncPorts } from "./app/qbo-time-sync-handler";

// API surface. NOTE: importing this barrel pulls the router (and thus the config validator) —
// unit tests must import the specific file they need, never `* from` here (see CLAUDE.md).
export { createQboRouter } from "./api/qbo-router";
export { qboStatusDTO, type QboStatusDTO } from "./api/qbo-dto";
