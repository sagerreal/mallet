import type { Result, ExternalServiceError } from "@mallet/shared/types";

/**
 * Registering a freshly bought number for INBOUND VOICE.
 *
 * Buying a number from Twilio gives you a line that rings — into Twilio's default "you have reached
 * a number that has not been configured" recording. A shop whose customers hear that is worse off
 * than one with no number at all, because the number is on their invoices and their truck.
 *
 * Separate port from NumberProvisioner because the two fail independently: the purchase can succeed
 * and the voice registration fail, and the correct outcome then is a shop that can TEXT while
 * somebody fixes voice — not a rolled-back purchase.
 */
export interface VoiceRegistrar {
  /**
   * Point this number at the AI front desk.
   *
   * Implementations MUST be idempotent on the number: provisioning is retried, and a second
   * registration of the same line should be a no-op rather than a duplicate that splits calls.
   */
  register(cmd: { phoneNumber: string }): Promise<Result<void, ExternalServiceError>>;
}
