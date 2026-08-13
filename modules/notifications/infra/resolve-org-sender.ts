import "server-only";
import { loadConfig } from "@mallet/shared/config";
import { readOrgSmsIdentity } from "@mallet/a2p";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Clock, OrgId } from "@mallet/shared/types";
import type { NotificationSender } from "../domain/notification-sender";
import { LoggingNotificationSender } from "./logging-notification-sender";
import { TwilioSmsSender } from "./twilio-sms-sender";
import { OrgSmsNotificationSender } from "./org-sms-notification-sender";
import { pickSmsIdentity } from "./sms-identity";

/**
 * modules/notifications/infra/resolve-org-sender.ts
 * THE ONE WAY TO GET A SENDER THAT KNOWS WHICH SHOP IT IS SENDING FOR.
 *
 * `ctx.deps.notificationSender` is built once, at server boot. That is correct for email — Resend
 * sends as the platform either way — and cannot work for text: at boot the process does not know
 * which tenant a message belongs to, so all six automated SMS paths were pinned to one configured
 * line for the life of the process, whatever the shop owned. (`TWILIO_FROM_NUMBER` has never been
 * set in any environment, so in practice every automated text was logged and never sent.)
 *
 * This resolves the identity per request and hands back a sender that routes SMS to it: the
 * shop's own number and Messaging Service once both exist, the shared platform line
 * (MALLET_SHARED_SMS_*) until then — so a shop can bill on its first day while A2P vetting runs.
 * See pickSmsIdentity for the precedence. Email is left exactly where it was, and every call site
 * that can reach the `sms` channel uses this; nothing else needs to.
 *
 * WHY NOT AT BOOT, CACHED. The identity changes underneath a running process — a shop is
 * provisioned a number, a campaign finishes vetting and mints its Messaging Service — and a cache
 * would keep sending from the old line until the next deploy. Two indexed single-row reads inside
 * a transaction the caller already holds is not the cost worth optimising.
 */
export const resolveOrgNotificationSender = async (args: {
  readonly tx: TenantTx;
  readonly orgId: OrgId;
  /** The boot-time sender. Keeps email; never used for SMS once this resolves. */
  readonly base: NotificationSender | undefined;
  readonly clock: Clock;
}): Promise<NotificationSender> => {
  const base = args.base ?? new LoggingNotificationSender(args.clock);
  const config = loadConfig();

  // No Twilio at all on this server: leave the composed sender alone so SMS degrades to the
  // logging stub exactly as it did before, and `assertDelivered` still refuses to claim delivery.
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) return base;

  const org = await readOrgSmsIdentity(args.tx, args.orgId);

  // The shop's own line once it has one, the shared platform line until then. See pickSmsIdentity
  // for why a number with no Messaging Service does not count as an identity at all.
  const identity = pickSmsIdentity(
    { fromNumber: org?.fromNumber, messagingServiceSid: org?.messagingServiceSid },
    {
      fromNumber: config.MALLET_SHARED_SMS_NUMBER,
      messagingServiceSid: config.MALLET_SHARED_SMS_MESSAGING_SERVICE_SID,
    },
  );

  const smsSender = identity
    ? new TwilioSmsSender(
        config.TWILIO_ACCOUNT_SID,
        config.TWILIO_AUTH_TOKEN,
        identity.fromNumber,
        args.clock,
        undefined,
        config.PUBLIC_APP_URL,
        identity.messagingServiceSid,
      )
    : null;

  return new OrgSmsNotificationSender(base, smsSender);
};
