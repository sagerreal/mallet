import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type NotificationChannel = "sms" | "email";
export type NotificationStatus = "queued" | "sent" | "failed";
export type RelatedType = "invoice" | "estimate";

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ["sms", "email"];
export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = ["queued", "sent", "failed"];

export const isNotificationChannel = (v: string): v is NotificationChannel =>
  (NOTIFICATION_CHANNELS as readonly string[]).includes(v);
export const isNotificationStatus = (v: string): v is NotificationStatus =>
  (NOTIFICATION_STATUSES as readonly string[]).includes(v);

const MAX_REMINDER_STAGE = 2;

export interface NotificationProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly channel: NotificationChannel;
  readonly to: string; // E.164 phone (sms) or email address (email) — validated at the boundary
  readonly kind: string; // template id, e.g. "invoice_reminder"
  readonly body: string; // rendered snapshot, frozen at compose time
  readonly status: NotificationStatus;
  readonly relatedType: RelatedType | null;
  readonly relatedId: string | null;
  readonly reminderStage: number | null; // 0..2 for reminder sends; null for one-offs
  readonly idempotencyKey: string;
  readonly externalId: string | null;
  readonly error: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

// A customer-facing message (SMS or email). Append-only ledger row whose only mutable field is a
// terminal status stamp (queued → sent | failed). Immutable in code: transitions return new
// instances. The body is frozen at compose time.
export class Notification {
  private constructor(private readonly p: NotificationProps) {}

  static create(props: NotificationProps): Result<Notification, ValidationError> {
    if (!isNotificationChannel(props.channel)) {
      return err(validation(`unknown channel: ${props.channel}`, "channel"));
    }
    if (props.to.trim().length === 0) return err(validation("recipient is required", "to"));
    if (props.kind.trim().length === 0) return err(validation("kind is required", "kind"));
    if (props.body.trim().length === 0) return err(validation("body is required", "body"));
    if (props.idempotencyKey.trim().length < 8) {
      return err(validation("idempotency key must be at least 8 chars", "idempotencyKey"));
    }
    if ((props.relatedType === null) !== (props.relatedId === null)) {
      return err(validation("relatedType and relatedId must be set together", "relatedId"));
    }
    if (props.reminderStage !== null && (props.reminderStage < 0 || props.reminderStage > MAX_REMINDER_STAGE)) {
      return err(validation("reminder stage must be 0..2", "reminderStage"));
    }
    return ok(new Notification(props));
  }

  // queued → sent. Idempotent: re-marking a sent notification is a no-op (same instance).
  markSent(externalId: string | null, now: Date): Result<Notification, ValidationError> {
    if (this.p.status === "sent") return ok(this);
    if (this.p.status !== "queued") {
      return err(validation("only a queued notification can be marked sent", "status"));
    }
    return ok(new Notification({ ...this.p, status: "sent", externalId, sentAt: now }));
  }

  // queued → failed, capturing the reason. A sent notification cannot be failed.
  markFailed(reason: string, _now: Date): Result<Notification, ValidationError> {
    if (this.p.status !== "queued") {
      return err(validation("only a queued notification can be marked failed", "status"));
    }
    return ok(new Notification({ ...this.p, status: "failed", error: reason }));
  }

  get props(): NotificationProps {
    return this.p;
  }
}
