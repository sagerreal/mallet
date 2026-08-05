import type { Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";
import type { NotificationChannel } from "./notification";

/**
 * WHICH WAY the customer's copy of a document goes out — resolved from the customer's own record,
 * never chosen by the caller.
 *
 * The person tapping "Send" is standing at a door with a phone in their hand. They must not be
 * able to type a destination: a phone number or an email address accepted from that surface is an
 * exfiltration primitive ("send this customer's bill to me"), and a channel picker there is a
 * question nobody at a door can answer. So the ONLY inputs are the lead's stored contact fields
 * plus whether this shop may legally text at all.
 *
 * SMS first when it is available, because the customer is holding their phone. Email is the
 * fallback, not a downgrade — and critically, it is the fallback for a shop whose 10DLC campaign
 * is not approved, which is most shops before they finish registration. Falling back is not a
 * bypass of that gate: an unapproved org never sends SMS here, it sends email instead.
 *
 * Both refusals name the ACTUAL problem and the next step, because both are fixable by the shop.
 */

export interface DocumentChannelInput {
  /** The lead's stored phone (E.164), or null. */
  readonly phone: string | null;
  /** The lead's stored email, or null. */
  readonly email: string | null;
  /** Whether this org's 10DLC registration is active — see isSmsA2pActive. */
  readonly smsAllowed: boolean;
}

export const pickDocumentChannel = ({
  phone,
  email,
  smsAllowed,
}: DocumentChannelInput): Result<NotificationChannel, ValidationError> => {
  if (phone && smsAllowed) return ok("sms");
  if (email) return ok("email");
  if (phone) {
    // A phone is on file but the shop cannot text yet, and there is no email to fall back to.
    // Naming both halves matters: "no email on file" alone would send someone to fix the wrong one.
    return err(
      validation(
        "texting isn't approved for this org yet, and this customer has no email on file — add an email or finish 10DLC registration",
        "to",
      ),
    );
  }
  return err(validation("this customer has no phone or email on file", "to"));
};
