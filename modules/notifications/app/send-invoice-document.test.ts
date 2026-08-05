import { describe, it, expect } from "vitest";
import { asOrgId, isOk, ok } from "@mallet/shared/types";
import type { Result, AppError, CursorPage, Paginated } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { ReminderTarget, ReminderTargetReader } from "../domain/reminder-target-reader";
import type { RelatedType } from "../domain/notification";
import { Notification } from "../domain/notification";
import type { SendNotificationUseCase } from "./send-notification";
import { SendInvoiceDocumentUseCase } from "./send-invoice-document";

const ORG = asOrgId("11111111-1111-1111-1111-111111111111");
const INV = "55555555-5555-5555-5555-555555555555";
const TOKEN = "b".repeat(64);
const ORIGIN = "https://app.trymallet.com";

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

class SpySend {
  public lastCmd: Parameters<SendNotificationUseCase["exec"]>[0] | null = null;
  constructor(private readonly result: Result<Notification, AppError>) {}
  async exec(cmd: Parameters<SendNotificationUseCase["exec"]>[0]): Promise<Result<Notification, AppError>> {
    this.lastCmd = cmd;
    return this.result;
  }
}

let idSeq = 0;
const countingIds = (): IdGenerator => ({ newId: () => `id-${++idSeq}` });

const target = (over: Partial<ReminderTarget> = {}): ReminderTarget => ({
  type: "invoice",
  id: INV,
  num: "INV-2000",
  status: "sent",
  sentAt: new Date("2026-08-05T00:00:00Z"),
  phone: "+15559876543",
  email: "customer@example.com",
  balanceCents: 18_500,
  publicToken: TOKEN,
  createdAt: new Date("2026-08-05T00:00:00Z"),
  ...over,
});

const stub = (): Notification => {
  const r = Notification.create({
    id: "notif-001",
    orgId: ORG,
    channel: "sms",
    to: "+15559876543",
    kind: "invoice_sent",
    body: "body",
    status: "queued",
    relatedType: "invoice",
    relatedId: INV,
    reminderStage: null,
    idempotencyKey: "document:55555555-5555-5555-5555-555555555555:id-1",
    externalId: null,
    error: null,
    sentAt: null,
    createdAt: new Date("2026-08-05T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("stub failed");
  return r.value;
};

const run = async (t: ReminderTarget | null, smsAllowed: boolean, origin: string | null = ORIGIN) => {
  const send = new SpySend(ok(stub()));
  const useCase = new SendInvoiceDocumentUseCase(new FakeReader(t), send as unknown as SendNotificationUseCase, countingIds(), origin);
  const result = await useCase.exec({ orgId: ORG, invoiceId: INV, smsAllowed });
  return { result, send };
};

describe("SendInvoiceDocumentUseCase", () => {
  it("returns not-found when the invoice does not exist", async () => {
    const { result, send } = await run(null, true);
    expect(isOk(result)).toBe(false);
    expect(send.lastCmd).toBeNull();
  });

  describe("the channel comes from the customer's record, never the caller", () => {
    it("texts when a phone is on file and the shop may text", async () => {
      const { send } = await run(target(), true);
      expect(send.lastCmd?.channel).toBe("sms");
      expect(send.lastCmd?.to).toBe("+15559876543");
    });

    it("emails when the org's 10DLC campaign is not active", async () => {
      const { send } = await run(target(), false);
      expect(send.lastCmd?.channel).toBe("email");
      expect(send.lastCmd?.to).toBe("customer@example.com");
    });

    it("emails when there is no phone on file", async () => {
      const { send } = await run(target({ phone: null }), true);
      expect(send.lastCmd?.channel).toBe("email");
    });

    it("refuses — and sends NOTHING — when the customer has no contact at all", async () => {
      const { result, send } = await run(target({ phone: null, email: null }), true);
      expect(isOk(result)).toBe(false);
      expect(send.lastCmd).toBeNull();
    });
  });

  describe("the copy comes from the invoice's own balance, never the caller", () => {
    it("sends the BILL while money is owed", async () => {
      const { send } = await run(target({ balanceCents: 18_500 }), true);
      expect(send.lastCmd?.kind).toBe("invoice_sent");
      expect(send.lastCmd?.body).toContain("$185.00 is ready");
      expect(send.lastCmd?.body).toContain(`${ORIGIN}/i/${TOKEN}`);
    });

    it("sends the RECEIPT once nothing is owed, and never asks for money on it", async () => {
      const { send } = await run(target({ balanceCents: 0, status: "paid" }), true);
      expect(send.lastCmd?.kind).toBe("payment_receipt");
      expect(send.lastCmd?.body).toContain("paid in full");
      expect(send.lastCmd?.body).toContain("itemized receipt");
      expect(send.lastCmd?.body).not.toContain("pay");
    });

    it("treats an overpaid balance as settled too", async () => {
      const { send } = await run(target({ balanceCents: -500 }), true);
      expect(send.lastCmd?.kind).toBe("payment_receipt");
    });
  });

  describe("the link", () => {
    it("carries the customer's /i/<token> page — the document, not a bare number", async () => {
      const { send } = await run(target(), true);
      expect(send.lastCmd?.body).toContain(`${ORIGIN}/i/${TOKEN}`);
    });

    it("composes without a link rather than sending a half-built one", async () => {
      const { send } = await run(target({ publicToken: null }), true);
      expect(send.lastCmd?.body).not.toContain("http");
      expect(send.lastCmd?.body).toContain("INV-2000");
    });

    it("composes without a link when the deployment has no canonical origin", async () => {
      const { send } = await run(target(), true, null);
      expect(send.lastCmd?.body).not.toContain("http");
    });
  });

  it("relates the message to the invoice and carries no reminder stage", async () => {
    const { send } = await run(target(), true);
    expect(send.lastCmd?.relatedType).toBe("invoice");
    expect(send.lastCmd?.relatedId).toBe(INV);
    expect(send.lastCmd?.reminderStage).toBeNull();
  });

  it("mints a FRESH idempotency key per send, so a retry genuinely re-sends", async () => {
    // A deterministic key would make the retry after a provider failure return the failed row.
    const { send: a } = await run(target(), true);
    const { send: b } = await run(target(), true);
    expect(a.lastCmd?.idempotencyKey).not.toBe(b.lastCmd?.idempotencyKey);
    expect(a.lastCmd?.idempotencyKey.startsWith(`document:${INV}:`)).toBe(true);
  });

  it("takes the org from the command, never from the target row", async () => {
    const { send } = await run(target(), true);
    expect(send.lastCmd?.orgId).toBe(ORG);
  });
});
