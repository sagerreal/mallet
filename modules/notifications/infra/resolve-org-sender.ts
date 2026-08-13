import "server-only";
import { loadConfig } from "@mallet/shared/config";
import { readOrgSmsIdentity } from "@mallet/a2p";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Clock, OrgId } from "@mallet/shared/types";
import type { NotificationSender } from "../domain/notification-sender";
import { LoggingNotificationSender } from "./logging-notification-sender";
import { TwilioSmsSender } from "./twilio-sms-sender";
import { OrgSmsNotificationSender } from "./org-sms-notification-sender";

/**
 * modules/notifications/infra/resolve-org-sender.ts
 * THE ONE WAY TO GET A SENDER THAT KNOWS WHICH SHOP IT IS SENDING FOR.
 *
 * `ctx.deps.notificationSender` is built once, at server boot, from `TWILIO_FROM_NUMBER`. That is
 * correct for email — Resend sends as the platform either way — and correct for a shop that has no
 * number of its own, which is what that shared line is FOR. What it cannot do is stop: at boot the
 * process does not know which tenant a message belongs to, so all six automated SMS paths stayed
 * on that one line permanently, including for shops that had finished registering their own.
 *
 * This resolves the shop's own number and Messaging Service per request and hands back a sender
 * that routes SMS there once they exist — and to the platform's shared line until they do, so a
 * shop can still bill on its first day while A2P vetting runs. Email is left exactly where it was.
 * Every call site that can reach the `sms` channel uses it; nothing else needs to.
 *
 * WHY NOT AT BOOT, CACHED. The identity changes underneath a running process — a shop is
 * provisioned a number, a campaign finishes vetting and mints its Messaging Service — and a cache
 * would keep texting from the old identity (or refusing) until the next deploy. Two indexed
 * single-row reads inside a transaction the caller already holds is not the cost worth optimising.
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

  const identity = await readOrgSmsIdentity(args.tx, args.orgId);

  // A number with no Messaging Service is treated as no identity at all, and falls back to the
  // shared line. The campaign attaches to the SERVICE — sending bare from the shop's own number is
  // the unregistered-traffic shape that made every text before A2P fail at the carrier, so it is
  // strictly worse than the shared line, which at least rides a registered one.
  const orgSms =
    identity && identity.messagingServiceSid
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

  return new OrgSmsNotificationSender(base, orgSms);
};
