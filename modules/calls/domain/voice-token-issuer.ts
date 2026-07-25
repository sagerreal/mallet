import type { UserId } from "@mallet/shared/types";

/**
 * A short-lived credential the BROWSER authenticates to the voice provider with.
 *
 * It exists because the softphone runs on the client, where our real provider credentials can
 * never go. The token is scoped to one person and one purpose (place calls through our TwiML
 * application) and expires quickly, so a leaked one is worth little and not for long.
 */
export interface VoiceAccessToken {
  readonly token: string;
  /** Who the provider will see the call as coming from. */
  readonly identity: string;
  readonly expiresAt: Date;
}

export interface VoiceTokenIssuer {
  issue(userId: UserId, now: Date): VoiceAccessToken;
}
