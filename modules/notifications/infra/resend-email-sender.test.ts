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

// A counting fake transport lets us assert retry behaviour (attempts per send) and the mapping.
const sender = (transport: EmailTransport) => new ResendEmailSender("re_test_dummy", "Elas <x@example.com>", CLOCK, transport);

describe("ResendEmailSender", () => {
  it("maps a successful send to a receipt with the provider message id (one attempt)", async () => {
    let calls = 0;
    const captured: Array<{ subject: string; idempotencyKey: string; to: string }> = [];
    const s = sender(async (payload, options) => {
      calls += 1;
      captured.push({ subject: payload.subject, idempotencyKey: options.idempotencyKey, to: payload.to });
      return { data: { id: "re_msg_123" }, error: null };
    });
    const r = await s.send(cmd());
    expect(isOk(r) && r.value.externalId).toBe("re_msg_123");
    expect(isOk(r) && r.value.sentAt).toEqual(CLOCK.now());
    expect(calls).toBe(1);
    expect(captured[0]).toEqual({ subject: "Your invoice is ready", idempotencyKey: "idem-email-1", to: "cust@example.com" });
  });

  it("treats a deterministic 4xx as a rejection: no retry, generic error, no raw provider text leaked", async () => {
    let calls = 0;
    const s = sender(async () => {
      calls += 1;
      return { data: null, error: { message: "cust@example.com is not a valid recipient", statusCode: 422, name: "validation_error" } };
    });
    const r = await s.send(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.message).not.toContain("example.com"); // provider text (incl. recipient) stays server-side
    }
    expect(calls).toBe(1); // deterministic 4xx is NOT retried
  });

  it("retries a transient failure (5xx) — the idempotency key makes a retry a no-op, not a second email", async () => {
    let calls = 0;
    const s = sender(async () => {
      calls += 1;
      return { data: null, error: { message: "upstream error", statusCode: 503, name: "internal_server_error" } };
    });
    const r = await s.send(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
    expect(calls).toBe(3); // 1 initial + 2 retries (idempotent:true)
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
