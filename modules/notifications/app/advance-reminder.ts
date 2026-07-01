import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err } from "@mallet/shared/types";
import type { Notification, RelatedType } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";
import type { ReminderTargetReader } from "../domain/reminder-target-reader";
import type { FollowUpPolicy } from "../domain/follow-up-policy";
import { composeInvoiceReminder } from "../templates/invoice-reminder";
import type { SendNotificationUseCase } from "./send-notification";

export interface AdvanceReminderCommand {
  readonly orgId: OrgId;
  readonly relatedType: RelatedType;
  readonly relatedId: string;
}

// Send the next-due reminder for one target, or no-op if none is due / the sequence is complete.
// Deduped by the idempotency key `reminder:<id>:<stage>`, so concurrent scheduler ticks send a
// given stage at most once. Returns null when nothing was due.
export class AdvanceReminderUseCase {
  constructor(
    private readonly reader: ReminderTargetReader,
    private readonly repo: NotificationRepository,
    private readonly send: SendNotificationUseCase,
    private readonly policy: FollowUpPolicy,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: AdvanceReminderCommand): Promise<Result<Notification | null, AppError>> {
    // Pilot: only invoices have a reminder template. Estimate follow-ups need their own copy
    // (no balance, not "Invoice"-worded) — reusing the invoice template would send a wrong message.
    if (cmd.relatedType !== "invoice") {
      return err(validation("reminders are only supported for invoices", "relatedType"));
    }
    const target = await this.reader.findTarget(cmd.relatedType, cmd.relatedId);
    if (!target) return err(notFound("target"));

    const stages = await this.repo.sentReminderStages(cmd.relatedType, [cmd.relatedId]);
    const alreadySent = stages.get(cmd.relatedId) ?? [];
    const stage = this.policy.nextReminderDue(target.status, target.sentAt, alreadySent, this.clock.now());
    if (stage === null) return ok(null); // nothing due, or sequence complete

    const channel = target.phone ? "sms" : target.email ? "email" : null;
    if (channel === null) return err(validation("the customer has no phone or email on file", "to"));
    const to = channel === "sms" ? (target.phone as string) : (target.email as string);

    return this.send.exec({
      orgId: cmd.orgId,
      channel,
      to,
      kind: "invoice_reminder",
      body: composeInvoiceReminder(target, stage),
      relatedType: cmd.relatedType,
      relatedId: cmd.relatedId,
      reminderStage: stage,
      idempotencyKey: `reminder:${cmd.relatedId}:${stage}`,
    });
  }
}
