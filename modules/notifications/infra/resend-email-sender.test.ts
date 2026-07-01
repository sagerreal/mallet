import { describe, it, expect } from "vitest";
import { asOrgId, isOk, FixedClock } from "@mallet/shared/types";
import type { SendNotificationCmd } from "../domain/notification-sender";
import { ResendEmailSender, type EmailTransport } from "./resend-email-sender";

const ORG = asOrgId("22222222-2222-4222-8222-222222222222");
const CLOCK = new FixedClock(new Date("2026-07-01T00:00:00Z"));

const cmd = (): SendNotificationCmd => ({
  orgId: ORG,
  channel: "email",
  to: "cust@example.com",
  body: "Your invoice is ready.",
  kind: "invoice_sent",
  idempotencyKey: "idem-email-1",
});

// A fake transport lets us exercise the adapter's mapping without a real Resend call.
const sender = (transport: EmailTransport) => new ResendEmailSender("re_test_dummy", "Mallet <x@example.com>", CLOCK, transport);

describe("ResendEmailSender", () => {
  it("maps a successful send to a receipt with the provider message id", async () => {
    const captured: Array<{ subject: string; idempotencyKey: string; to: string }> = [];
    const s = sender(async (payload, options) => {
      captured.push({ subject: payload.subject, idempotencyKey: options.idempotencyKey, to: payload.to });
      return { data: { id: "re_msg_123" }, error: null };
    });
    const r = await s.send(cmd());
    expect(isOk(r) && r.value.externalId).toBe("re_msg_123");
    expect(isOk(r) && r.value.sentAt).toEqual(CLOCK.now());
    expect(captured[0]).toEqual({ subject: "Your invoice is ready", idempotencyKey: "idem-email-1", to: "cust@example.com" });
  });

  it("maps an API-level rejection to a generic external_service error (no raw provider text leaked)", async () => {
    const s = sender(async () => ({ data: null, error: { message: "Domain example.com is not verified" } }));
    const r = await s.send(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.message).not.toContain("example.com"); // provider detail stays server-side
    }
  });

  it("maps a thrown network error to an external_service error", async () => {
    const s = sender(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await s.send(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
  });
});
