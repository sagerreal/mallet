import { describe, it, expect } from "vitest";
import { asOutboundCallId, asPhone } from "@mallet/shared/types";
import { TwilioCallOriginator, type CallHttpTransport } from "./twilio-call-originator";

// ── constants ──────────────────────────────────────────────────────────────
const SID = "AC00000000000000000000000000000000";
const VOICE_URL = "https://app.example.com/api/voice/outbound";
const STATUS_URL = "https://app.example.com/api/webhooks/twilio/voice-status";
const CALL_ID = asOutboundCallId("11111111-1111-1111-1111-111111111111");
const AGENT = asPhone("+17813850591");
const BUSINESS = asPhone("+16693413343");

// ── helpers ────────────────────────────────────────────────────────────────
const originator = (transport: CallHttpTransport) =>
  new TwilioCallOriginator(SID, "token", VOICE_URL, STATUS_URL, transport);

const cmd = () => ({ callId: CALL_ID, agentNumber: AGENT, fromNumber: BUSINESS });

// Twilio's RestException shape: an Error carrying numeric .status and .code.
const restError = (status: number, code: number) => Object.assign(new Error("provider said no"), { status, code });

describe("TwilioCallOriginator", () => {
  it("rings the AGENT leg with the business line as caller ID", async () => {
    let seen: Parameters<CallHttpTransport>[0] | undefined;
    const o = originator(async (p) => {
      seen = p;
      return { sid: "CA123" };
    });
    await o.originate(cmd());
    expect(seen?.to).toBe(AGENT);
    expect(seen?.from).toBe(BUSINESS);
  });

  it("sends only our call id to the provider — never the customer's number", async () => {
    let seen: Parameters<CallHttpTransport>[0] | undefined;
    const o = originator(async (p) => {
      seen = p;
      return { sid: "CA123" };
    });
    await o.originate(cmd());
    expect(seen?.url).toBe(`${VOICE_URL}?callId=${CALL_ID}`);
    // The destination must be absent from every provider-facing field.
    expect(JSON.stringify(seen)).not.toContain("9415550134");
  });

  it("subscribes to the status events the webhook needs to close the log out", async () => {
    let seen: Parameters<CallHttpTransport>[0] | undefined;
    const o = originator(async (p) => {
      seen = p;
      return { sid: "CA123" };
    });
    await o.originate(cmd());
    expect(seen?.statusCallback).toBe(STATUS_URL);
    expect(seen?.statusCallbackEvent).toContain("completed");
  });

  it("returns the provider call SID on success", async () => {
    const o = originator(async () => ({ sid: "CA999" }));
    const r = await o.originate(cmd());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.providerCallSid).toBe("CA999");
  });

  it("treats a 4xx as a non-retryable rejection", async () => {
    const o = originator(async () => {
      throw restError(400, 21215);
    });
    const r = await o.originate(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("external_service");
      expect(r.error.retryable).toBe(false);
    }
  });

  it("does not retry — one press of Call must never ring the agent twice", async () => {
    let attempts = 0;
    const o = originator(async () => {
      attempts += 1;
      throw restError(500, 20500);
    });
    await o.originate(cmd());
    expect(attempts).toBe(1);
  });

  it("keeps a bad number from disabling voice for everyone (4xx must not trip the breaker)", async () => {
    let attempts = 0;
    const o = originator(async () => {
      attempts += 1;
      throw restError(400, 21215);
    });
    for (let i = 0; i < 8; i += 1) await o.originate(cmd());
    expect(attempts).toBe(8);
  });

  it("opens the breaker after repeated provider outages", async () => {
    let attempts = 0;
    const o = originator(async () => {
      attempts += 1;
      throw restError(503, 20500);
    });
    for (let i = 0; i < 8; i += 1) await o.originate(cmd());
    // threshold 5 → calls 6-8 short-circuit without reaching the transport.
    expect(attempts).toBe(5);
  });

  it("never leaks a phone number in the returned error message", async () => {
    const o = originator(async () => {
      throw restError(400, 21215);
    });
    const r = await o.originate(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain("781");
      expect(r.error.message).not.toContain("669");
    }
  });
});
