import type { Result, ExternalServiceError } from "@mallet/shared/types";
import type { BusinessInfo } from "./registration";

export type RemoteStatus = "pending" | "approved" | "rejected" | "unknown";

export interface CampaignContent {
  readonly description: string;
  readonly messageSamples: string[];
  readonly consentDescription: string;
  readonly optInMessage: string;
  readonly usecase: string; // e.g. "LOW_VOLUME"
}

/**
 * Port: everything the A2P module needs from Twilio's TrustHub + Messaging surface. Each method
 * returns a typed ExternalServiceError on failure and never throws provider internals across the
 * boundary. Ordering/idempotency live in the use case, not here.
 */
export interface A2pGateway {
  createSecondaryProfile(cmd: { orgId: string; info: BusinessInfo }): Promise<Result<{ profileSid: string }, ExternalServiceError>>;
  registerBrand(cmd: { profileSid: string; kind: "standard" | "sole_proprietor" }): Promise<Result<{ brandSid: string }, ExternalServiceError>>;
  createMessagingService(cmd: { orgId: string }): Promise<Result<{ messagingServiceSid: string }, ExternalServiceError>>;
  registerCampaign(cmd: { messagingServiceSid: string; brandSid: string; content: CampaignContent }): Promise<Result<{ campaignSid: string }, ExternalServiceError>>;
  attachNumber(cmd: { messagingServiceSid: string; phoneNumberSid: string }): Promise<Result<void, ExternalServiceError>>;
  fetchStatus(cmd: { profileSid: string | null; brandSid: string | null; campaignSid: string | null }): Promise<Result<{ profile: RemoteStatus; brand: RemoteStatus; campaign: RemoteStatus }, ExternalServiceError>>;
}
