import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { conflict, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Notification, type NotificationChannel, type RelatedType } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";
import type { NotificationSender } from "../domain/notification-sender";

export interface SendNotificationCommand {
  readonly orgId: OrgId;
  readonly channel: NotificationChannel;
  readonly to: string;
  readonly kind: string;
  readonly body: string;
  readonly relatedType: RelatedType | null;
  readonly relatedId: string | null;
  readonly reminderStage: number | null;
  readonly idempotencyKey: string;
}

// Send one message. Idempotent at the ledger: claim the key FIRST (ON CONFLICT DO NOTHING); a
// duplicate key returns the existing row without re-sending. A sender failure is recorded as
// status='failed' and returned as ok (graceful degradation — the request never hard-fails). This
// is intentionally different from payments, where a gateway failure must roll back.
//
// NOTE: a failed send is NOT auto-retried in the pilot. The deferred retry worker (Phase 2 Inngest)
// will re-drive failed rows BY ID (the deterministic reminder key is already consumed, so a re-send
// cannot go back through this claim path). Until then, a failed reminder stage stays eligible
// (sentReminderStages counts only delivered stages) but a manual re-trigger returns the failed row.
export class SendNotificationUseCase {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly sender: NotificationSender,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SendNotificationCommand): Promise<Result<Notification, AppError>> {
    const notification = Notification.create({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      channel: cmd.channel,
      to: cmd.to,
      kind: cmd.kind,
      body: cmd.body,
      status: "queued",
      relatedType: cmd.relatedType,
      relatedId: cmd.relatedId,
      reminderStage: cmd.reminderStage,
      idempotencyKey: cmd.idempotencyKey,
      externalId: null,
      error: null,
      sentAt: null,
      createdAt: this.clock.now(),
    });
    if (!isOk(notification)) return notification;

    const claimed = await this.repo.insert(notification.value);
    if (!claimed) {
      const existing = await this.repo.findByIdempotencyKey(cmd.idempotencyKey);
      return existing ? ok(existing) : err(conflict("duplicate notification"));
    }

    const id = notification.value.props.id;
    const receipt = await this.sender.send({
      orgId: cmd.orgId,
      channel: cmd.channel,
      to: cmd.to,
      body: cmd.body,
      kind: cmd.kind,
      idempotencyKey: cmd.idempotencyKey,
    });

    if (!isOk(receipt)) {
      // Graceful degradation: record the failure (committed) and return it, don't throw.
      const failed = await this.repo.markFailed(id, receipt.error.message);
      return failed ? ok(failed) : err(notFound("notification"));
    }

    const sent = await this.repo.markSent(id, receipt.value.externalId, this.clock.now());
    if (!sent) return err(notFound("notification"));
    await this.bus.emit({
      name: "notification.sent",
      orgId: cmd.orgId,
      payload: {
        notificationId: sent.props.id,
        channel: cmd.channel,
        kind: cmd.kind,
        relatedType: cmd.relatedType,
        relatedId: cmd.relatedId,
      },
      occurredAt: this.clock.now(),
    });
    return ok(sent);
  }
}
