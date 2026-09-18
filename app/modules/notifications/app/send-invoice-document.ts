import type { OrgId, Result, AppError } from "@mallet/shared/types";
import { notFound, isOk, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Notification } from "../domain/notification";
import type { ReminderTargetReader } from "../domain/reminder-target-reader";
import { pickDocumentChannel } from "../domain/document-channel";
import { composeInvoiceSent, composePaymentReceipt, invoicePayUrl } from "../templates/invoice-reminder";
import type { SendNotificationUseCase } from "./send-notification";

/**
 * Send the customer their copy of an invoice — the bill while money is owed, the RECEIPT once it
 * is not.
 *
 * The gap this closes: on a cash-at-the-door close-out the customer received nothing at all. No
 * document was shown, no message was sent. `SendInvoiceUseCase` flips draft -> sent and mints the
 * pay-link token but fires no notification (docs/adr/0004-outbox-relay-scheduler.md), and the one
 * endpoint that DOES notify (`v1.notifications.sendInvoiceReminder`) is ownerOrOffice — so the
 * person actually standing in front of the customer had no way to hand them anything.
 *
 * TWO THINGS ARE DECIDED HERE, AND NEITHER IS THE CALLER'S:
 *
 *  1. THE CHANNEL, from the lead's own stored contact fields (see pickDocumentChannel). No phone
 *     number, email address or channel flag is accepted from the client. A field surface that
 *     could name a destination would be a way to mail a customer's bill somewhere else.
 *
 *  2. THE COPY, from the invoice's own balance. A settled bill gets the receipt sentence; an open
 *     one gets the bill sentence. Letting a caller choose would let a $0 balance go out asking to
 *     be paid, or an open one go out saying "paid in full — thank you".
 *
 * A distinct sibling of SendInvoiceNotificationUseCase rather than a flag on it: that one takes an
 * explicit channel and refuses if the matching contact field is missing ("no silent channel
 * switch" is deliberate for an office caller who picked SMS on purpose). Here nobody picked, so
 * resolving is correct rather than a switch. The office path is untouched.
 *
 * Manual, not a reminder stage — a fresh idempotency key each time, so a retry after a provider
 * failure genuinely re-sends instead of returning the failed row.
 */
export interface SendInvoiceDocumentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: string;
  /**
   * Whether this org may send SMS right now (10DLC campaign active). Resolved by the caller via
   * `isSmsA2pActive` and passed in, so this use-case stays pure of the a2p module and testable
   * against both answers.
   */
  readonly smsAllowed: boolean;
}

export class SendInvoiceDocumentUseCase {
  constructor(
    private readonly reader: ReminderTargetReader,
    private readonly send: SendNotificationUseCase,
    private readonly ids: IdGenerator,
    // resolvePublicAppOrigin(config) — injected so the compose stays testable and the origin
    // decision lives in the wiring, exactly as the sibling invoice sends do.
    private readonly publicOrigin: string | null,
  ) {}

  async exec(cmd: SendInvoiceDocumentCommand): Promise<Result<Notification, AppError>> {
    const target = await this.reader.findTarget("invoice", cmd.invoiceId);
    if (!target) return err(notFound("invoice"));

    const channel = pickDocumentChannel({
      phone: target.phone,
      email: target.email,
      smsAllowed: cmd.smsAllowed,
    });
    if (!isOk(channel)) return channel;

    // Non-null by construction: pickDocumentChannel only answers "sms" when phone is set and
    // "email" when email is.
    const to = channel.value === "sms" ? (target.phone as string) : (target.email as string);
    const url = invoicePayUrl(this.publicOrigin, target.publicToken);
    const settled = target.balanceCents <= 0;

    return this.send.exec({
      orgId: cmd.orgId,
      channel: channel.value,
      to,
      kind: settled ? "payment_receipt" : "invoice_sent",
      body: settled ? composePaymentReceipt(target, url) : composeInvoiceSent(target, url),
      relatedType: "invoice",
      relatedId: cmd.invoiceId,
      reminderStage: null,
      idempotencyKey: `document:${cmd.invoiceId}:${this.ids.newId()}`,
    });
  }
}
