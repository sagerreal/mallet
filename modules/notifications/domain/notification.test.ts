import { describe, it, expect } from "vitest";
import { asOrgId, isOk } from "@mallet/shared/types";
import { Notification, type NotificationProps } from "./notification";
import { FollowUpPolicy } from "./follow-up-policy";

const props = (overrides: Partial<NotificationProps> = {}): NotificationProps => ({
  id: "00000000-0000-0000-0000-000000000001",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  channel: "sms",
  to: "+15551234567",
  kind: "invoice_reminder",
  body: "You owe $100.",
  status: "queued",
  relatedType: "invoice",
  relatedId: "44444444-4444-4444-4444-444444444444",
  reminderStage: 1,
  idempotencyKey: "reminder:44444444:1",
  externalId: null,
  error: null,
  sentAt: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

const now = new Date("2026-06-10T00:00:00Z");

describe("Notification.create", () => {
  it("rejects unknown channel, empty to/kind/body, short key, mismatched related pair, bad stage", () => {
    expect(Notification.create(props({ channel: "carrier-pigeon" as never })).ok).toBe(false);
    expect(Notification.create(props({ to: " " })).ok).toBe(false);
    expect(Notification.create(props({ kind: "" })).ok).toBe(false);
    expect(Notification.create(props({ body: "  " })).ok).toBe(false);
    expect(Notification.create(props({ idempotencyKey: "short" })).ok).toBe(false);
    expect(Notification.create(props({ relatedType: null })).ok).toBe(false); // relatedId still set
    expect(Notification.create(props({ reminderStage: 5 })).ok).toBe(false);
  });
});

describe("Notification status transitions", () => {
  it("markSent stamps sentAt + externalId and is idempotent", () => {
    const created = Notification.create(props());
    if (!isOk(created)) throw new Error("create failed");
    const r = created.value.markSent("ext-1", now);
    expect(isOk(r) && r.value.props.status).toBe("sent");
    if (isOk(r)) {
      expect(r.value.props.sentAt?.toISOString()).toBe(now.toISOString());
      const again = r.value.markSent("ext-2", now);
      expect(isOk(again) && again.value).toBe(r.value); // no-op
    }
  });

  it("markFailed refuses a sent notification", () => {
    const created = Notification.create(props());
    if (!isOk(created)) throw new Error("create failed");
    const sent = created.value.markSent(null, now);
    if (!isOk(sent)) throw new Error("markSent failed");
    expect(sent.value.markFailed("bounce", now).ok).toBe(false);
    // but a queued one can fail
    expect(created.value.markFailed("bounce", now).ok).toBe(true);
  });
});

describe("FollowUpPolicy", () => {
  const policy = new FollowUpPolicy();
  const sentAt = new Date("2026-06-01T00:00:00Z");

  it("is null before day 3, stage 1 at >=3d, stage 2 at >=6d once stage 1 sent, null after stage 2", () => {
    expect(policy.nextReminderDue("sent", sentAt, [], new Date("2026-06-02T00:00:00Z"))).toBeNull();
    expect(policy.nextReminderDue("sent", sentAt, [], new Date("2026-06-04T00:00:00Z"))).toBe(1);
    expect(policy.nextReminderDue("sent", sentAt, [1], new Date("2026-06-08T00:00:00Z"))).toBe(2);
    expect(policy.nextReminderDue("sent", sentAt, [1, 2], new Date("2026-06-20T00:00:00Z"))).toBeNull();
  });

  it("stops the sequence for terminal targets", () => {
    expect(policy.isSequenceComplete("paid")).toBe(true);
    expect(policy.isSequenceComplete("accepted")).toBe(true);
    expect(policy.nextReminderDue("paid", sentAt, [], new Date("2026-06-20T00:00:00Z"))).toBeNull();
  });

  it("never walks backward to a gentler stage after a catch-up send", () => {
    // A late first run catches up to stage 2; a later tick must NOT then send stage 1.
    expect(policy.nextReminderDue("sent", sentAt, [], new Date("2026-06-09T00:00:00Z"))).toBe(2);
    expect(policy.nextReminderDue("sent", sentAt, [2], new Date("2026-06-20T00:00:00Z"))).toBeNull();
  });
});
