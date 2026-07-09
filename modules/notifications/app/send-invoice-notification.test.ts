import { describe, it, expect, vi } from "vitest";
import { asOrgId, isOk } from "@mallet/shared/types";
import type { Result, AppError } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { ReminderTarget, ReminderTargetReader } from "../domain/reminder-target-reader";
import type { RelatedType } from "../domain/notification";
import type { CursorPage, Paginated } from "@mallet/shared/types";
import { Notification } from "../domain/notification";
import type { SendNotificationUseCase } from "./send-notification";
import { SendInvoiceNotificationUseCase } from "./send-invoice-notification";

const ORG = asOrgId("11111111-1111-1111-1111-111111111111");
const INV = "55555555-5555-5555-5555-555555555555";

// ─── fakes ───────────────────────────────────────────────────────────────────

class FakeReader implements ReminderTargetReader {
  constructor(private readonly target: ReminderTarget | null) {}

  async findTarget(type: RelatedType, id: string): Promise<ReminderTarget | null> {
    if (!this.target) return null;
    return this.target.type === type && this.target.id === id ? this.target : null;
  }

  async findOpenInvoiceTargets(_page: CursorPage): Promise<Paginated<ReminderTarget>> {
    return { items: [], nextCursor: null };
  }
}

// A minimal spy that captures the last command passed to exec and returns ok(stub).
class SpySendUseCase {
  public lastCmd: Parameters<SendNotificationUseCase["exec"]>[0] | null = null;
  public result: Result<Notification, AppError>;

  constructor(result: Result<Notification, AppError>) {
    this.result = result;
  }

  async exec(cmd: Parameters<SendNotificationUseCase["exec"]>[0]): Promise<Result<Notification, AppError>> {
    this.lastCmd = cmd;
    return this.result;
  }
}

const fixedIds = (): IdGenerator => ({ newId: () => "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });

const baseTarget = (overrides: Partial<ReminderTarget> = {}): ReminderTarget => ({
  type: "invoice",
  id: INV,
  num: "INV-2000",
  status: "sent",
  sentAt: new Date("2026-06-01T00:00:00Z"),
  phone: "+15559876543",
  email: "customer@example.com",
  balanceCents: 50_000,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

// Build a minimal stub Notification so SpySendUseCase can return something sensible.
// We reach into Notification.create to get a real instance without a live DB.
const stubNotification = (): Notification => {
  const r = Notification.create({
    id: "notif-001",
    orgId: ORG,
    channel: "sms",
    to: "+15559876543",
    kind: "invoice_sent",
    body: "Invoice INV-2000 for $500.00 is ready. Reply or call to pay. Thank you.",
    status: "queued",
    relatedType: "invoice",
    relatedId: INV,
    reminderStage: null,
    idempotencyKey: "manual:55555555-5555-5555-5555-555555555555:aaaaaaaa",
    externalId: null,
    error: null,
    sentAt: null,
    createdAt: new Date("2026-06-10T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("stubNotification: create failed: " + JSON.stringify(r));
  return r.value;
};

// ─── tests ───────────────────────────────────────────────────────────────────

describe("SendInvoiceNotificationUseCase", () => {
  describe("findTarget not-found", () => {
    it("returns a not-found error when the invoice does not exist in the reader", async () => {
      const reader = new FakeReader(null);
      const spy = new SpySendUseCase({ ok: false, error: { kind: "not_found", message: "invoice" } } as any);
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
        expect(result.error.message).toMatch(/invoice/i);
      }
      // send must NOT have been called
      expect(spy.lastCmd).toBeNull();
    });

    it("returns a not-found error when the reader has a target for a different invoiceId", async () => {
      const reader = new FakeReader(baseTarget({ id: "different-invoice-id" }));
      const spy = new SpySendUseCase({ ok: false, error: { kind: "not_found", message: "invoice" } } as any);
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("not_found");
      expect(spy.lastCmd).toBeNull();
    });
  });

  describe("channel validation — missing contact field", () => {
    it("returns a validation error for sms channel when the target has no phone", async () => {
      const target = baseTarget({ phone: null });
      const reader = new FakeReader(target);
      const spy = new SpySendUseCase({ ok: true, value: stubNotification() });
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
        // message must mention phone
        expect(result.error.message).toMatch(/phone/i);
      }
      expect(spy.lastCmd).toBeNull();
    });

    it("returns a validation error for email channel when the target has no email", async () => {
      const target = baseTarget({ email: null });
      const reader = new FakeReader(target);
      const spy = new SpySendUseCase({ ok: true, value: stubNotification() });
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "email" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
        expect(result.error.message).toMatch(/email/i);
      }
      expect(spy.lastCmd).toBeNull();
    });
  });

  describe("happy path — compose + send delegation", () => {
    it("sms channel: delegates to send.exec with phone as 'to', correct kind/relatedType, and a manual idempotency key", async () => {
      const target = baseTarget();
      const reader = new FakeReader(target);
      const notif = stubNotification();
      const spy = new SpySendUseCase({ ok: true, value: notif });
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(notif);

      expect(spy.lastCmd).not.toBeNull();
      const cmd = spy.lastCmd!;
      expect(cmd.orgId).toBe(ORG);
      expect(cmd.channel).toBe("sms");
      expect(cmd.to).toBe(target.phone); // must use phone, not email
      expect(cmd.kind).toBe("invoice_sent");
      expect(cmd.relatedType).toBe("invoice");
      expect(cmd.relatedId).toBe(INV);
      expect(cmd.reminderStage).toBeNull();
      expect(cmd.idempotencyKey).toMatch(/^manual:/);
      // body must include the invoice number and balance
      expect(cmd.body).toContain("INV-2000");
      expect(cmd.body).toContain("500.00");
    });

    it("email channel: delegates to send.exec with email as 'to'", async () => {
      const target = baseTarget();
      const reader = new FakeReader(target);
      const notif = stubNotification();
      const spy = new SpySendUseCase({ ok: true, value: notif });
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "email" });

      expect(result.ok).toBe(true);
      const cmd = spy.lastCmd!;
      expect(cmd.channel).toBe("email");
      expect(cmd.to).toBe(target.email); // must use email, not phone
    });

    it("each call generates a unique idempotency key (manual resend is intentionally not idempotent across calls)", async () => {
      const target = baseTarget();
      const reader = new FakeReader(target);
      let callCount = 0;
      const ids: IdGenerator = { newId: () => `id-${(callCount += 1)}` };
      const spy1 = new SpySendUseCase({ ok: true, value: stubNotification() });
      const spy2 = new SpySendUseCase({ ok: true, value: stubNotification() });
      const uc1 = new SendInvoiceNotificationUseCase(reader, spy1 as unknown as SendNotificationUseCase, ids);
      const uc2 = new SendInvoiceNotificationUseCase(reader, spy2 as unknown as SendNotificationUseCase, ids);

      await uc1.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });
      await uc2.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(spy1.lastCmd!.idempotencyKey).not.toBe(spy2.lastCmd!.idempotencyKey);
    });

    it("propagates send.exec failure result to the caller unchanged", async () => {
      const target = baseTarget();
      const reader = new FakeReader(target);
      const sendError = { ok: false as const, error: { kind: "external_service" as const, service: "sms-gateway", message: "gateway down", retryable: true } };
      const spy = new SpySendUseCase(sendError);
      const uc = new SendInvoiceNotificationUseCase(reader, spy as unknown as SendNotificationUseCase, fixedIds());

      const result = await uc.exec({ orgId: ORG, invoiceId: INV, channel: "sms" });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("external_service");
    });
  });
});
