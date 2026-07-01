import type { CursorPage, Paginated } from "@mallet/shared/types";
import type {
  Notification,
  NotificationChannel,
  NotificationStatus,
  RelatedType,
} from "./notification";

export interface NotificationFilter {
  readonly channel?: NotificationChannel;
  readonly status?: NotificationStatus;
  readonly kind?: string;
}

export interface NotificationRepository {
  // Idempotent append via ON CONFLICT (org_id, idempotency_key) DO NOTHING RETURNING. true if this
  // call inserted, false if the key was already claimed (a retry / duplicate reminder stage).
  insert(notification: Notification): Promise<boolean>;
  markSent(id: string, externalId: string | null, sentAt: Date): Promise<Notification | null>;
  markFailed(id: string, error: string): Promise<Notification | null>;
  findById(id: string): Promise<Notification | null>;
  // Return the row already holding a key (for the dedupe-hit path, since our fresh row wasn't inserted).
  findByIdempotencyKey(key: string): Promise<Notification | null>;
  // Which reminder stages have already been claimed per target — batched to avoid N+1 in the
  // scheduler query. Keyed by relatedId.
  sentReminderStages(
    relatedType: RelatedType,
    relatedIds: readonly string[],
  ): Promise<Map<string, number[]>>;
  list(page: CursorPage, filter?: NotificationFilter): Promise<Paginated<Notification>>;
}
