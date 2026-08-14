import { eq } from "drizzle-orm";
import { orgs, a2pRegistrations } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";

/**
 * modules/a2p/app/org-sms-identity.ts
 * WHICH NUMBER A SHOP'S CUSTOMER-FACING TEXTS GO OUT FROM.
 *
 * Two facts, and both have to travel together: the shop's own business line
 * (`orgs.twilio_number`) and the Messaging Service its 10DLC campaign attaches to
 * (`a2p_registrations.messaging_service_sid`). The number is what the customer sees; the service
 * is what carriers check. Sending the number without the service reads as unregistered traffic
 * even when the campaign is approved and that number sits in the service's own pool.
 *
 * WHY THIS EXISTS AS A READ. `messaging.send` resolved both inline and every automated
 * notification — invoice sent, payment reminders, receipts, the technician's send-at-the-door,
 * front-desk booking confirmations, the agent's reminders — did not. Those six were built from ONE
 * sender constructed at server boot, before the process knows which shop is sending, so they all
 * went out from a single `TWILIO_FROM_NUMBER` with no service at all. On a second shop that means
 * the customer sees another business's number, and a reply lands in that other business's inbox.
 *
 * Jobber and Housecall Pro both put every customer-facing message on the shop's own registered
 * number; Jobber's shared pool exists only for the gap BEFORE a shop registers, and moves off it
 * once the number is live. This read is what lets Mallet do the same.
 */
export interface OrgSmsIdentity {
  /** The shop's own business line — what the customer sees, and replies to. */
  readonly fromNumber: string;
  /**
   * The Messaging Service carrying the 10DLC campaign. Null when registration has not reached the
   * point of creating one; a send with a number but no service is deliverable-in-theory and
   * filtered-in-practice, so callers treat null as "not ready" rather than "send it bare".
   */
  readonly messagingServiceSid: string | null;
}

/**
 * The org's texting identity, or null when it owns no number.
 *
 * Null is a real answer, not an error: a shop that has not been provisioned a business line has
 * nothing to send from. Callers must refuse rather than substitute a platform number — that
 * substitution is the bug this read exists to remove.
 */
export const readOrgSmsIdentity = async (
  tx: TenantTx,
  orgId: OrgId,
): Promise<OrgSmsIdentity | null> => {
  const [org] = await tx
    .select({ twilioNumber: orgs.twilioNumber })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);

  const fromNumber = org?.twilioNumber ?? null;
  if (!fromNumber) return null;

  const [reg] = await tx
    .select({ messagingServiceSid: a2pRegistrations.messagingServiceSid })
    .from(a2pRegistrations)
    .where(eq(a2pRegistrations.orgId, orgId))
    .limit(1);

  return { fromNumber, messagingServiceSid: reg?.messagingServiceSid ?? null };
};
