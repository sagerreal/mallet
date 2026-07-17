import type { Result, ExternalServiceError } from "@mallet/shared/types";

// The connected-account status the app persists — a narrow projection of the Stripe Account object.
export interface ConnectAccountStatus {
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

/**
 * Port: everything the settings module needs from the payment provider's Connect surface.
 * Onboarding only (PR1) — no charge/transfer here. Implementations return typed
 * ExternalServiceError; they never throw provider internals across the port.
 */
export interface ConnectGateway {
  createConnectedAccount(cmd: {
    readonly orgId: string;
  }): Promise<Result<{ accountId: string }, ExternalServiceError>>;
  createOnboardingLink(cmd: {
    readonly accountId: string;
    readonly refreshUrl: string;
    readonly returnUrl: string;
  }): Promise<Result<{ url: string }, ExternalServiceError>>;
  retrieveStatus(accountId: string): Promise<Result<ConnectAccountStatus, ExternalServiceError>>;
}
