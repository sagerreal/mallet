import { jwt } from "twilio";
import type { UserId } from "@mallet/shared/types";
import type { VoiceTokenIssuer, VoiceAccessToken } from "../domain/voice-token-issuer";

const { AccessToken } = jwt;
const { VoiceGrant } = AccessToken;

/**
 * Ten minutes. Twilio allows up to 24 hours, but the token only has to survive the moment
 * between "the page wants to call" and "the device is registered" — anything longer is a
 * credential sitting in a browser tab for no reason. The client re-fetches when it expires.
 */
const TTL_SECONDS = 600;

/**
 * Mints Twilio Access Tokens for the Voice JS SDK.
 *
 * The API key pair SIGNS the token; it is never sent to the browser. The key MUST be a Standard
 * key — Twilio does not support signing Access Tokens with a Restricted key, and the failure is a
 * runtime 20101 from the client rather than anything visible at boot.
 *
 * `incomingAllow` is false on purpose: this device places calls, it does not receive them. Inbound
 * belongs to the AI front desk, and letting a browser register to take calls would silently divert
 * them from it.
 */
export class TwilioVoiceTokenIssuer implements VoiceTokenIssuer {
  constructor(
    private readonly accountSid: string,
    private readonly apiKeySid: string,
    private readonly apiKeySecret: string,
    private readonly twimlAppSid: string,
  ) {}

  issue(userId: UserId, now: Date): VoiceAccessToken {
    // The identity is what the provider labels the client leg with. The user id keeps it stable
    // and carries no personal data into provider-side logs.
    const identity = `user-${userId}`;
    const token = new AccessToken(this.accountSid, this.apiKeySid, this.apiKeySecret, {
      identity,
      ttl: TTL_SECONDS,
    });
    token.addGrant(new VoiceGrant({ outgoingApplicationSid: this.twimlAppSid, incomingAllow: false }));
    return {
      token: token.toJwt(),
      identity,
      expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000),
    };
  }
}
