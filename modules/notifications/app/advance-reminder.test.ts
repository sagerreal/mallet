import { describe, it, expect } from "vitest";
import {
  asOrgId,
  FixedClock,
  buildPage,
  err,
  externalService,
  isOk,
  type OrgId,
  type CursorPage,
  type Paginated,
  type Result,
  type ExternalServiceError,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Notification } from "../domain/notification";
import type { NotificationRepository, NotificationFilter } from "../domain/notification-repository";
import type { RelatedType } from "../domain/notification";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";
import type { ReminderTarget, ReminderTargetReader } from "../domain/reminder-target-reader";
import { FollowUpPolicy } from "../domain/follow-up-policy";
import { LoggingNotificationSender } from "../infra/logging-notification-sender";
import { SendNotificationUseCase } from "./send-notification";
import { AdvanceReminderUseCase } from "./advance-reminder";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const INV = "44444444-4444-4444-4444-444444444444";

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String((n += 1)).padStart(12, "0")}` };
};

class FakeNotificationRepository implements NotificationRepository {
  private readonly store = new Map<string, Notification>();
  private readonly keys = new Set<string>();

  async insert(n: Notification): Promise<boolean> {
    if (this.keys.has(n.props.idempotencyKey)) return false;
    this.keys.add(n.props.idempotencyKey);
    this.store.set(n.props.id, n);
    return true;
  }
  async markSent(id: string, externalId: string | null, sentAt: Date): Promise<Notification | null> {
    const n = this.store.get(id);
    if (!n) return null;
    const r = n.markSent(externalId, sentAt);
    if (!isOk(r)) return null;
    this.store.set(id, r.value);
    return r.value;
  }
  async markFailed(id: string, error: string): Promise<Notification | null> {
    const n = this.store.get(id);
    if (!n) return null;
    const r = n.markFailed(error, new Date());
    if (!isOk(r)) return null;
    this.store.set(id, r.value);
    return r.value;
  }
  async findById(id: string): Promise<Notification | null> {
    return this.store.get(id) ?? null;
  }
  async findByIdempotencyKey(key: string): Promise<Notification | null> {
    return [...this.store.values()].find((n) => n.props.idempotencyKey === key) ?? null;
  }
  async sentReminderStages(relatedType: RelatedType, ids: readonly string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    for (const n of this.store.values()) {
      const p = n.props;
      if (
        p.relatedType === relatedType &&
        p.relatedId &&
        ids.includes(p.relatedId) &&
        p.reminderStage !== null &&
        p.status === "sent"
      ) {
        map.set(p.relatedId, [...(map.get(p.relatedId) ?? []), p.reminderStage]);
      }
    }
    return map;
  }
  async list(page: CursorPage, filter?: NotificationFilter): Promise<Paginated<Notification>> {
    let rows = [...this.store.values()].sort(
      (a, b) => b.props.createdAt.getTime() - a.props.createdAt.getTime(),
    );
    if (filter?.status) rows = rows.filter((n) => n.props.status === filter.status);
    if (filter?.channel) rows = rows.filter((n) => n.props.channel === filter.channel);
    return buildPage(rows.slice(0, page.limit + 1), page, (n) => ({
      createdAt: n.props.createdAt,
      id: n.props.id,
    }));
  }
}

class FakeReader implements ReminderTargetReader {
  constructor(private target: ReminderTarget | null) {}
  async findTarget(type: RelatedType, id: string): Promise<ReminderTarget | null> {
    return this.target && this.target.type === type && this.target.id === id ? this.target : null;
  }
  async findOpenInvoiceTargets(page: CursorPage): Promise<Paginated<ReminderTarget>> {
    const items = this.target ? [this.target] : [];
    return buildPage(items.slice(0, page.limit + 1), page, (t) => ({
      createdAt: t.createdAt,
      id: t.id,
    }));
  }
}

class CountingSender implements NotificationSender {
  public calls = 0;
  private readonly inner: LoggingNotificationSender;
  constructor(clock: FixedClock) {
    this.inner = new LoggingNotificationSender(clock);
  }
  send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    this.calls += 1;
    return this.inner.send(cmd);
  }
}

const invoiceTarget = (overrides: Partial<ReminderTarget> = {}): ReminderTarget => ({
  type: "invoice",
  id: INV,
  num: "INV-1000",
  status: "sent",
  sentAt: new Date("2026-06-01T00:00:00Z"),
  phone: "+15551234567",
  email: "cust@example.com",
  balanceCents: 100_000,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

describe("AdvanceReminderUseCase — uncovered branches", () => {
  const policy = new FollowUpPolicy();

  it("returns a validation error when relatedType is not 'invoice' (e.g. estimate)", async () => {
    const clock = new FixedClock(new Date("2026-06-10T00:00:00Z"));
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());
    const advance = new AdvanceReminderUseCase(new FakeReader(null), repo, send, policy, clock);

    const result = await advance.exec({ orgId: ORG, relatedType: "estimate", relatedId: INV });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("relatedType");
    }
    // No send should occur before the guard
    expect(sender.calls).toBe(0);
  });

  it("returns a validation error when the customer has no phone or email on file", async () => {
    // 4 days after sentAt puts us past the 3-day stage-1 threshold so a reminder is due.
    const clock = new FixedClock(new Date("2026-06-05T00:00:00Z"));
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());

    // Target with neither phone nor email — channel resolves to null.
    const noContactTarget = invoiceTarget({ phone: null, email: null });
    const reader = new FakeReader(noContactTarget);
    const advance = new AdvanceReminderUseCase(reader, repo, send, policy, clock);

    const result = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("to");
    }
    // No send should reach the sender
    expect(sender.calls).toBe(0);
  });

  it("prefers SMS over email when both contact methods are present", async () => {
    // Confirms the channel-selection logic: phone wins over email.
    const clock = new FixedClock(new Date("2026-06-05T00:00:00Z"));
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());

    const targetWithBoth = invoiceTarget({ phone: "+15559876543", email: "cust@example.com" });
    const reader = new FakeReader(targetWithBoth);
    const advance = new AdvanceReminderUseCase(reader, repo, send, policy, clock);

    const result = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });

    expect(isOk(result)).toBe(true);
    if (isOk(result) && result.value !== null) {
      expect(result.value.props.channel).toBe("sms");
      expect(result.value.props.to).toBe("+15559876543");
    }
  });

  it("falls back to email when only email is present (no phone)", async () => {
    const clock = new FixedClock(new Date("2026-06-05T00:00:00Z"));
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());

    const emailOnlyTarget = invoiceTarget({ phone: null, email: "email-only@example.com" });
    const reader = new FakeReader(emailOnlyTarget);
    const advance = new AdvanceReminderUseCase(reader, repo, send, policy, clock);

    const result = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });

    expect(isOk(result)).toBe(true);
    if (isOk(result) && result.value !== null) {
      expect(result.value.props.channel).toBe("email");
      expect(result.value.props.to).toBe("email-only@example.com");
    }
  });
});
