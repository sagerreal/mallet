import type { Result, ExternalServiceError } from "@mallet/shared/types";

/**
 * Buying a shop its business phone number.
 *
 * Separate from A2pGateway on purpose. That gateway registers a business for TEXTING, which needs
 * an EIN, carrier vetting and days of review. A number needs none of that — voice works the day
 * it is bought — so a shop can answer calls immediately and register for texting whenever they get
 * round to it. Tying the two together would mean nobody can take a call until TCR approves them.
 */

export interface NumberSearch {
  /** The shop's ZIP, collected at signup. A local area code is the whole point. */
  readonly postalCode: string | null;
}

export interface ProvisionedNumber {
  /** E.164, e.g. "+17815550123". */
  readonly phoneNumber: string;
  /** Twilio's PN… resource sid — A2pGateway.attachNumber needs this later, and it cannot be
   *  derived from the E.164 string, so it has to be captured at purchase. */
  readonly phoneNumberSid: string;
}

export interface NumberProvisioner {
  /**
   * Find and buy a number, preferring one local to `postalCode`.
   *
   * Implementations MUST widen rather than fail when the exact area is sold out: a shop with a
   * working number in the next area code is far better off than a shop with none.
   */
  provision(search: NumberSearch): Promise<Result<ProvisionedNumber, ExternalServiceError>>;
}
