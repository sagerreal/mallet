import type { OrgId, Result, AppError } from "@mallet/shared/types";
import { notFound, validation, err } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Notification, NotificationChannel } from "../domain/notification";
import type { ReminderTargetReader } from "../domain/reminder-target-reader";
import { composeInvoiceSent } from "../templates/invoice-reminder";
import type { SendNotificationUseCase } from "./send-notification";

export interface SendInvoiceNotificationCommand {
  readonly orgId: OrgId;
  readonly invoiceId: string;
  readonly channel: NotificationChannel;
}

// Compose an "here is your invoice" message from the invoice + its lead's contact, then send it.
// A manual send/resend (fresh idempotency key each time). Requires the lead to have the matching
// contact field for the chosen channel — no silent channel switch.
export class SendInvoiceNotificationUseCase {
  constructor(
    private readonly reader: ReminderTargetReader,
    private readonly send: SendNotificationUseCase,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SendInvoiceNotificationCommand): Promise<Result<Notification, AppError>> {
    const target = await this.reader.findTarget("invoice", cmd.invoiceId);
    if (!target) return err(notFound("invoice"));

    const to = cmd.channel === "sms" ? target.phone : target.email;
    if (!to) {
      return err(validation(`the customer has no ${cmd.channel === "sms" ? "phone" : "email"} on file`, "to"));
    }

    return this.send.exec({
      orgId: cmd.orgId,
      channel: cmd.channel,
      to,
      kind: "invoice_sent",
      body: composeInvoiceSent(target),
      relatedType: "invoice",
      relatedId: cmd.invoiceId,
      reminderStage: null,
      idempotencyKey: `manual:${cmd.invoiceId}:${this.ids.newId()}`,
    });
  }
}
