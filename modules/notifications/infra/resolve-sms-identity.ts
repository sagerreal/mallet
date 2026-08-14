import "server-only";
import { loadConfig } from "@mallet/shared/config";
import { readOrgSmsIdentity } from "@mallet/a2p";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { pickSmsIdentity, type SmsSendingIdentity } from "./sms-identity";

/**
 * modules/notifications/infra/resolve-sms-identity.ts
 * WHICH LINE THIS SHOP'S AUTOMATED TEXTS GO OUT ON — asked once, answered in one place.
 *
 * Both the gate ("may this send happen at all?") and the sender ("send it from what?") need the
 * same answer, and they must never disagree. When they did, the shared line was unreachable: every
 * automated path asked `isSmsA2pActive` — is THIS SHOP's own campaign live — and refused before the
 * sender was ever built. So a shop waiting on carrier vetting still could not send an invoice
 * reminder, which is the exact thing the shared line exists to make possible.
 *
 * The right question for an AUTOMATED message is not "is this shop registered" but "is there a
 * registered line to send from" — the shop's own once it has one, Mallet's shared line until then.
 * That is what this returns, and `null` means genuinely nothing to send from.
 *
 * NOT FOR CONVERSATIONS. Two-way texting still requires the shop's OWN number: a shared line
 * belongs to no shop, so an inbound reply has no thread to land in. `messaging.send` keeps its own
 * stricter gate (org number + campaign active) and must not be pointed at this.
 */
export const resolveSmsIdentity = async (
  tx: TenantTx,
  orgId: OrgId,
): Promise<SmsSendingIdentity | null> => {
  const config = loadConfig();
  // No Twilio on this server at all — nothing can send, whatever is registered.
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) return null;

  const org = await readOrgSmsIdentity(tx, orgId);
  return pickSmsIdentity(
    { fromNumber: org?.fromNumber, messagingServiceSid: org?.messagingServiceSid },
    {
      fromNumber: config.MALLET_SHARED_SMS_NUMBER,
      messagingServiceSid: config.MALLET_SHARED_SMS_MESSAGING_SERVICE_SID,
    },
  );
};

/**
 * "May this shop send an automated text right now?" — the gate's form of the same question.
 *
 * Replaces `isSmsA2pActive` on the SIX automated paths. That predicate is still correct where it
 * remains: the conversation router and the office UI, both of which speak about the shop's own
 * two-way line.
 */
export const canSendAutomatedSms = async (tx: TenantTx, orgId: OrgId): Promise<boolean> =>
  (await resolveSmsIdentity(tx, orgId)) !== null;
