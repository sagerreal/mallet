import { ok, err, externalService, systemClock, FixedClock } from "@mallet/shared/types";
import type { Result, ExternalServiceError, CursorPage, Paginated } from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
// Import the SPECIFIC files, NOT the @mallet/notifications barrel: the barrel re-exports the API
// router, which transitively pulls the config validator (throws without DB env) — the house
// unit-test gotcha. These deep imports keep this test-support module loadable without DB env.
import { SendNotificationUseCase } from "../../../notifications/app/send-notification";
import type { Geocoder, GeoPoint } from "../../domain/geocoder";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../../../notifications/domain/notification-sender";
import type { NotificationRepository } from "../../../notifications/domain/notification-repository";
import type { Notification } from "../../../notifications/domain/notification";

// Test-only support for the voice tools. book_visit routes its confirmation SMS through
// SendNotificationUseCase (not the raw sender) so it writes an observable notifications row; the
// helpers here build a REAL SendNotificationUseCase wired to an in-memory repository + a recording
// sender, so a test can assert both (a) the send went through the use-case and wrote a row, and
// (b) a degraded send (err/throw) never fails the booking. `mode` selects the sender behaviour.
export type SendMode = "ok" | "err" | "throw";

// Recording channel sender: captures every send and, per `mode`, returns ok, an err Result, or
// throws — so a test exercises the graceful-degrade paths through the real use-case.
export interface RecordingNotificationSender extends NotificationSender {
  readonly sent: SendNotificationCmd[];
}

export const recordingNotificationSender = (mode: SendMode = "ok"): RecordingNotificationSender => {
  const sent: SendNotificationCmd[] = [];
  return {
    sent,
    async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
      sent.push(cmd);
      if (mode === "throw") throw new Error("sms provider offline");
      if (mode === "err") return err(externalService("sms", "provider unavailable"));
      return ok({ externalId: "test:sent", channel: cmd.channel, sentAt: systemClock.now() });
    },
  };
};

// Minimal in-memory NotificationRepository: only the methods SendNotificationUseCase.exec calls are
// implemented (insert / findByIdempotencyKey / markSent / markFailed); the rest throw loudly if hit
// so an accidental new dependency surfaces in tests. `rows` exposes every persisted notification so
// a test can assert the observable row was written (the B3 requirement).
class InMemoryNotificationRepository implements NotificationRepository {
  readonly rows = new Map<string, Notification>();

  async insert(notification: Notification): Promise<boolean> {
    const key = notification.props.idempotencyKey;
    if ([...this.rows.values()].some((n) => n.props.idempotencyKey === key)) return false;
    this.rows.set(notification.props.id, notification);
    return true;
  }
  async markSent(id: string, externalId: string | null, sentAt: Date): Promise<Notification | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const marked = existing.markSent(externalId, sentAt);
    if (marked.ok === false) return null;
    this.rows.set(id, marked.value);
    return marked.value;
  }
  async markFailed(id: string, error: string): Promise<Notification | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const marked = existing.markFailed(error, systemClock.now());
    if (marked.ok === false) return null;
    this.rows.set(id, marked.value);
    return marked.value;
  }
  async findById(id: string): Promise<Notification | null> {
    return this.rows.get(id) ?? null;
  }
  async findByIdempotencyKey(key: string): Promise<Notification | null> {
    return [...this.rows.values()].find((n) => n.props.idempotencyKey === key) ?? null;
  }
  async sentReminderStages(): Promise<Map<string, number[]>> {
    throw new Error("InMemoryNotificationRepository: sentReminderStages not supported in tests");
  }
  async list(_page: CursorPage): Promise<Paginated<Notification>> {
    throw new Error("InMemoryNotificationRepository: list not supported in tests");
  }
}

// A recording SendNotificationUseCase for the voice tools' deps. Exposes the underlying sender's
// captured commands (`sent`) AND the persisted notification rows (`rows`) so a test can assert both
// the send and the observable row. Uses a fixed clock + sequence ids so assertions are deterministic.
export interface RecordingSendNotification {
  readonly useCase: SendNotificationUseCase;
  readonly sent: SendNotificationCmd[];
  readonly rows: Map<string, Notification>;
}

let idSeq = 0;
const testIds: IdGenerator = {
  newId: () => {
    idSeq += 1;
    return `10000000-0000-0000-0000-${String(idSeq).padStart(12, "0")}`;
  },
};

export const recordingSendNotification = (mode: SendMode = "ok"): RecordingSendNotification => {
  const sender = recordingNotificationSender(mode);
  const repo = new InMemoryNotificationRepository();
  const useCase = new SendNotificationUseCase(
    repo,
    sender,
    new InMemoryEventBus(),
    new FixedClock(new Date("2026-07-14T00:00:00Z")),
    testIds,
  );
  return { useCase, sent: sender.sent, rows: repo.rows };
};

// An inert SendNotificationUseCase for tools that never send (take_message, request_quote,
// check_availability): satisfies the deps shape with a no-recording success path.
export const inertSendNotification = (): SendNotificationUseCase =>
  recordingSendNotification("ok").useCase;

// An inert Geocoder for tools/tests that don't exercise the service-area path: always misses (→ the
// service-area check degrades to "unknown" → book normally), never throws. Satisfies the deps shape.
export const inertGeocoder = (): Geocoder => ({
  async geocode() {
    return null;
  },
});

// A fixed-point Geocoder for service-area tests: returns `point` for ANY address (never throws), so a
// test can pin the caller to a far/near coordinate deterministically without hitting the network.
export const fixedGeocoder = (point: GeoPoint): Geocoder => ({
  async geocode() {
    return point;
  },
});
