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

export { DrizzleQboConnectionRepository } from "./infra/drizzle-qbo-connection-repository";
export { HttpQboOauthGateway, type IntuitOauthConfig } from "./infra/http-qbo-oauth-gateway";

export { EnsureFreshAccessToken, type FreshAccess } from "./app/ensure-fresh-access-token";
export { CompleteQboConnect, type CompleteQboConnectCommand } from "./app/complete-qbo-connect";
export { DisconnectQbo } from "./app/disconnect-qbo";
export { GetQboStatus, type QboStatus } from "./app/get-qbo-status";
