import { describe, it, expect } from "vitest";
import { asOrgId, isOk, FixedClock } from "@mallet/shared/types";
import type { SendNotificationCmd } from "../domain/notification-sender";
import { TwilioSmsSender, type SmsTransport } from "./twilio-sms-sender";

const ORG = asOrgId("22222222-2222-4222-8222-222222222222");
const CLOCK = new FixedClock(new Date("2026-07-01T00:00:00Z"));
const SID = "AC" + "a".repeat(32);

const cmd = (): SendNotificationCmd => ({
  orgId: ORG,
  channel: "sms",
  to: "+15555550123",
  body: "Reminder: your invoice is due.",
  kind: "invoice_reminder",
  idempotencyKey: "idem-sms-1",
});

const sender = (transport: SmsTransport) => new TwilioSmsSender(SID, "token", "+15555550000", CLOCK, transport);

// Twilio RestException-shaped error.
const restError = (status: number, code: number) => Object.assign(new Error("provider detail with +15555550123"), { status, code });

describe("TwilioSmsSender", () => {
  it("maps a successful send to a receipt with the message sid", async () => {
    const s = sender(async () => ({ sid: "SM123" }));
    const r = await s.send(cmd());
    expect(isOk(r) && r.value.externalId).toBe("SM123");
    expect(isOk(r) && r.value.sentAt).toEqual(CLOCK.now());
  });

  it("deterministic per-recipient 4xx errors do NOT trip the breaker (a bad number can't disable SMS for valid ones)", async () => {
    let calls = 0;
    const s = sender(async () => {
      calls += 1;
      throw restError(400, 21211); // invalid 'To' number
    });
    // Far past the failure threshold of 5 — every call must still reach the transport (breaker stays closed).
    for (let i = 0; i < 8; i += 1) {
      const r = await s.send(cmd());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("external_service");
    }
    expect(calls).toBe(8); // no short-circuit — deterministic rejections were not counted as outages
  });

  it("transient 5xx errors trip the breaker after the threshold (fast-fail a real outage)", async () => {
    let calls = 0;
    const s = sender(async () => {
      calls += 1;
      throw restError(503, 20500); // provider outage
    });
    for (let i = 0; i < 8; i += 1) await s.send(cmd());
    // idempotent:false → one attempt per send; breaker opens after 5 failures, so calls 6-8 short-circuit.
    expect(calls).toBe(5);
  });

  it("never leaks the recipient/provider text in the returned error", async () => {
    const s = sender(async () => {
      throw restError(400, 21211);
    });
    const r = await s.send(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).not.toContain("+15555550123");
  });
});
