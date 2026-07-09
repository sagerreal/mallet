import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  FixedClock,
  toPage,
  buildPage,
  isOk,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Notification } from "../domain/notification";
import type { NotificationRepository, NotificationFilter } from "../domain/notification-repository";
import type { RelatedType } from "../domain/notification";
import { ListNotificationsUseCase, type ListNotificationsQuery } from "./list-notifications";

const ORG: OrgId = asOrgId("33333333-3333-3333-3333-333333333333");
const INV_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INV_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ─── in-memory fake (mirrors the one in notifications-use-cases.test.ts) ──────

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

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeNotification = (overrides: {
  id: string;
  idempotencyKey: string;
  channel?: "sms" | "email";
  status?: "queued" | "sent" | "failed";
  createdAt?: Date;
}): Notification => {
  const r = Notification.create({
    id: overrides.id,
    orgId: ORG,
    channel: overrides.channel ?? "sms",
    to: "+15551234567",
    kind: "invoice_sent",
    body: "Invoice is ready.",
    status: overrides.status ?? "queued",
    relatedType: "invoice",
    relatedId: INV_A,
    reminderStage: null,
    idempotencyKey: overrides.idempotencyKey,
    externalId: null,
    error: null,
    sentAt: null,
    createdAt: overrides.createdAt ?? new Date("2026-06-10T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("makeNotification: create failed: " + JSON.stringify(r));
  return r.value;
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ListNotificationsUseCase", () => {
  let repo: FakeNotificationRepository;
  let uc: ListNotificationsUseCase;

  beforeEach(() => {
    repo = new FakeNotificationRepository();
    uc = new ListNotificationsUseCase(repo);
  });

  it("delegates to repo.list and returns an empty page when the store is empty", async () => {
    const result = await uc.exec({ page: toPage() });
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns all notifications when no filter is supplied", async () => {
    const n1 = makeNotification({ id: "id-001", idempotencyKey: "key-001-sms", channel: "sms" });
    const n2 = makeNotification({ id: "id-002", idempotencyKey: "key-002-email", channel: "email" });
    await repo.insert(n1);
    await repo.insert(n2);

    const result = await uc.exec({ page: toPage() });

    expect(result.items).toHaveLength(2);
    // Both items must be Notification instances passed through unchanged.
    const ids = result.items.map((n) => n.props.id);
    expect(ids).toContain("id-001");
    expect(ids).toContain("id-002");
  });

  it("passes the status filter through to the repo (only matching rows returned)", async () => {
    const queued = makeNotification({ id: "id-q", idempotencyKey: "key-queued-01", status: "queued" });
    const sent = makeNotification({ id: "id-s", idempotencyKey: "key-sent-001", status: "sent" });
    await repo.insert(queued);
    await repo.insert(sent);

    const query: ListNotificationsQuery = { page: toPage(), filter: { status: "sent" } };
    const result = await uc.exec(query);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.props.id).toBe("id-s");
    expect(result.items[0]!.props.status).toBe("sent");
  });

  it("passes the channel filter through to the repo (only matching channel returned)", async () => {
    const sms = makeNotification({ id: "id-sms", idempotencyKey: "key-sms-ch01", channel: "sms" });
    const email = makeNotification({ id: "id-email", idempotencyKey: "key-email-ch01", channel: "email" });
    await repo.insert(sms);
    await repo.insert(email);

    const result = await uc.exec({ page: toPage(), filter: { channel: "email" } });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.props.id).toBe("id-email");
    expect(result.items[0]!.props.channel).toBe("email");
  });

  it("respects the page limit and sets nextCursor when there are more results", async () => {
    // Insert 3 notifications; request a page of 2.
    for (let i = 1; i <= 3; i++) {
      const n = makeNotification({
        id: `id-pg-00${i}`,
        idempotencyKey: `key-page-00${i}`,
        createdAt: new Date(`2026-06-0${i}T00:00:00Z`),
      });
      await repo.insert(n);
    }

    const result = await uc.exec({ page: toPage({ limit: 2 }) });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("returns all items with no next cursor when results fit within the limit", async () => {
    for (let i = 1; i <= 2; i++) {
      const n = makeNotification({
        id: `id-fit-00${i}`,
        idempotencyKey: `key-fit-000${i}`,
        createdAt: new Date(`2026-06-0${i}T00:00:00Z`),
      });
      await repo.insert(n);
    }

    const result = await uc.exec({ page: toPage({ limit: 10 }) });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });
});
