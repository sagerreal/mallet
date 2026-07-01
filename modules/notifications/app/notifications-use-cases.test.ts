import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  FixedClock,
  toPage,
  buildPage,
  externalService,
  err,
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
import { NextRemindersDueUseCase } from "./next-reminders-due";

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
      if (p.relatedType === relatedType && p.relatedId && ids.includes(p.relatedId) && p.reminderStage !== null) {
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

const failingSender: NotificationSender = {
  send: async () => err(externalService("twilio", "sms gateway down", true)),
};

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

describe("SendNotificationUseCase", () => {
  let clock: FixedClock;
  let repo: FakeNotificationRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-10T00:00:00Z"));
    repo = new FakeNotificationRepository();
    bus = new InMemoryEventBus();
  });

  const cmd = (key: string) => ({
    orgId: ORG,
    channel: "sms" as const,
    to: "+15551234567",
    kind: "invoice_sent",
    body: "Invoice INV-1000 is ready.",
    relatedType: "invoice" as const,
    relatedId: INV,
    reminderStage: null,
    idempotencyKey: key,
  });

  it("sends once, marks sent, and emits notification.sent", async () => {
    const sender = new CountingSender(clock);
    const uc = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());
    const r = await uc.exec(cmd("manual-key-0001"));
    expect(isOk(r) && r.value.props.status).toBe("sent");
    expect(sender.calls).toBe(1);
    expect(bus.recorded.filter((e) => e.name === "notification.sent")).toHaveLength(1);
  });

  it("is idempotent on the key — sender fires once, one event", async () => {
    const sender = new CountingSender(clock);
    const uc = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());
    await uc.exec(cmd("dup-key-00001"));
    const second = await uc.exec(cmd("dup-key-00001"));
    expect(isOk(second) && second.value.props.status).toBe("sent");
    expect(sender.calls).toBe(1);
    expect(bus.recorded.filter((e) => e.name === "notification.sent")).toHaveLength(1);
  });

  it("records a sender failure as status=failed (graceful degradation, not an error)", async () => {
    const uc = new SendNotificationUseCase(repo, failingSender, bus, clock, seqIds());
    const r = await uc.exec(cmd("fail-key-00001"));
    expect(isOk(r) && r.value.props.status).toBe("failed");
    expect(bus.recorded.some((e) => e.name === "notification.sent")).toBe(false);
  });
});

describe("AdvanceReminderUseCase", () => {
  const policy = new FollowUpPolicy();

  it("sends the due stage once and no-ops on repeat / terminal target", async () => {
    const clock = new FixedClock(new Date("2026-06-05T00:00:00Z")); // 4 days after sentAt -> stage 1 due
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());
    const reader = new FakeReader(invoiceTarget());
    const advance = new AdvanceReminderUseCase(reader, repo, send, policy, clock);

    const first = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });
    expect(isOk(first) && first.value?.props.reminderStage).toBe(1);
    expect(sender.calls).toBe(1);

    // Repeat while still < 6 days: stage 1 already sent, stage 2 not due -> no-op.
    const second = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });
    expect(isOk(second) && second.value).toBeNull();
    expect(sender.calls).toBe(1);
  });

  it("no-ops for a paid target (sequence complete)", async () => {
    const clock = new FixedClock(new Date("2026-06-20T00:00:00Z"));
    const repo = new FakeNotificationRepository();
    const bus = new InMemoryEventBus();
    const sender = new CountingSender(clock);
    const send = new SendNotificationUseCase(repo, sender, bus, clock, seqIds());
    const advance = new AdvanceReminderUseCase(
      new FakeReader(invoiceTarget({ status: "paid" })),
      repo,
      send,
      policy,
      clock,
    );
    const r = await advance.exec({ orgId: ORG, relatedType: "invoice", relatedId: INV });
    expect(isOk(r) && r.value).toBeNull();
    expect(sender.calls).toBe(0);
  });
});

describe("NextRemindersDueUseCase", () => {
  it("returns the open invoice once it ages past the first threshold", async () => {
    const repo = new FakeNotificationRepository();
    const reader = new FakeReader(invoiceTarget());
    const uc = new NextRemindersDueUseCase(reader, repo, new FollowUpPolicy());

    const tooSoon = await uc.exec(new Date("2026-06-02T00:00:00Z"), toPage());
    expect(tooSoon.items).toHaveLength(0);

    const due = await uc.exec(new Date("2026-06-05T00:00:00Z"), toPage());
    expect(due.items).toHaveLength(1);
    expect(due.items[0]?.stage).toBe(1);
  });
});
