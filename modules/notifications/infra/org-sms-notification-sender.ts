import type { Result, ExternalServiceError } from "@mallet/shared/types";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";

/**
 * modules/notifications/infra/org-sms-notification-sender.ts
 * WHICH NUMBER A SHOP'S AUTOMATED TEXTS GO OUT FROM — the shop's own once it has one, the
 * platform's shared line until then.
 *
 * This is the model Jobber and Housecall Pro both run, and the sequence matters:
 *
 *   no dedicated number yet   → the platform's shared pool. One-way: Jobber's own docs say the
 *                               client "cannot reply directly via text", because a pool number
 *                               belongs to no single business and a reply has nowhere to land.
 *   dedicated number live     → the shop's own line, for AUTOMATED messages too — "all of your
 *                               automated text messages come from the same number associated with
 *                               your company" — which is also what unlocks two-way.
 *
 * WHY THE SHARED LINE IS NOT A SHORTCUT. A2P vetting takes 5–7 business days and can take weeks.
 * Refusing to send an invoice or a receipt for that whole window would mean a shop that signed up
 * this morning cannot bill anybody until a carrier gets round to it. The shared line is what makes
 * day one work.
 *
 * WHY IT IS NOT THE PERMANENT ANSWER EITHER. Once the shop has its own number, every automated
 * message moves to it: the customer sees the business they hired rather than a line they cannot
 * place, they can save it, and a reply reaches the shop that sent it. Leaving automated traffic on
 * the shared line forever is the bug this file was written to fix — six paths were pinned to one
 * configured number regardless of what the shop owned.
 *
 * Non-SMS falls through untouched: 10DLC governs text messages and nothing else, and email has no
 * per-org sending identity to resolve.
 */
export class OrgSmsNotificationSender implements NotificationSender {
  constructor(
    /**
     * The platform sender: email, and the shared line for a shop with no number of its own.
     * Already the logging stub when texting is unconfigured on this server, so an unconfigured
     * deploy still degrades exactly as it did before rather than pretending to send.
     */
    private readonly base: NotificationSender,
    /** The shop's own SMS sender — null until it has both a number and a Messaging Service. */
    private readonly orgSms: NotificationSender | null,
  ) {}

  send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    if (cmd.channel !== "sms") return this.base.send(cmd);
    // The shop's own line wins the moment it exists. Until then the shared one carries it, so a
    // brand-new shop can still invoice, remind and receipt on its first day.
    return (this.orgSms ?? this.base).send(cmd);
  }
}
