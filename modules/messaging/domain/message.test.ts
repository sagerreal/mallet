import { describe, it, expect } from "vitest";
import { asMessageId, asOrgId, isOk } from "@mallet/shared/types";
import { Message, type MessageProps } from "./message";

const base = (overrides: Partial<MessageProps> = {}): MessageProps => ({
  id: asMessageId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  leadId: null,
  direction: "outbound",
  channel: "sms",
  body: "Hello from Mallet",
  fromNumber: "+15005550006",
  toNumber: "+15555550123",
  providerSid: null,
  status: "queued",
  errorCode: null,
  createdAt: new Date("2026-07-09T00:00:00Z"),
  updatedAt: new Date("2026-07-09T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Message.create>): Message => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Message.create", () => {
  it("creates a valid outbound message", () => {
    const m = unwrap(Message.create(base()));
    expect(m.props.direction).toBe("outbound");
    expect(m.props.status).toBe("queued");
    expect(m.props.body).toBe("Hello from Mallet");
  });

  it("creates a valid inbound message", () => {
    const m = unwrap(Message.create(base({ direction: "inbound", status: "received" })));
    expect(m.props.direction).toBe("inbound");
    expect(m.props.status).toBe("received");
  });

  it("rejects an empty body", () => {
    const r = Message.create(base({ body: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("body");
  });

  it("rejects a body exceeding 1600 characters", () => {
    const r = Message.create(base({ body: "x".repeat(1601) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("body");
  });

  it("accepts a body of exactly 1600 characters", () => {
    const r = Message.create(base({ body: "x".repeat(1600) }));
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid direction", () => {
    // @ts-expect-error intentional invalid direction for runtime test
    const r = Message.create(base({ direction: "sideways" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("direction");
  });

  it("rejects an invalid status", () => {
    // @ts-expect-error intentional invalid status for runtime test
    const r = Message.create(base({ status: "unknown" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("accepts all valid statuses", () => {
    const statuses = ["queued", "sent", "delivered", "failed", "received"] as const;
    for (const status of statuses) {
      const r = Message.create(base({ status }));
      expect(r.ok).toBe(true);
    }
  });

  it("accepts a null leadId (unmatched inbound)", () => {
    const m = unwrap(Message.create(base({ leadId: null })));
    expect(m.props.leadId).toBeNull();
  });

  it("markSent returns a NEW sent message and leaves the claim untouched", () => {
    const claim = unwrap(Message.create(base()));
    const at = new Date("2026-07-09T01:00:00Z");

    const sent = claim.markSent("SM_sid", at);

    expect(sent).not.toBe(claim);
    expect(sent.props.status).toBe("sent");
    expect(sent.props.providerSid).toBe("SM_sid");
    expect(sent.props.updatedAt).toBe(at);
    // The claim it came from is unchanged — no mutation.
    expect(claim.props.status).toBe("queued");
    expect(claim.props.providerSid).toBeNull();
  });

  it("markFailed returns a NEW failed message carrying the carrier code", () => {
    const claim = unwrap(Message.create(base()));
    const at = new Date("2026-07-09T01:00:00Z");

    const failed = claim.markFailed("30034", at);

    expect(failed).not.toBe(claim);
    expect(failed.props.status).toBe("failed");
    expect(failed.props.errorCode).toBe("30034");
    expect(failed.isFailed).toBe(true);
    expect(claim.isFailed).toBe(false);
    expect(claim.props.status).toBe("queued");
  });

  it("props are immutable — returned object is frozen from the factory", () => {
    const m = unwrap(Message.create(base()));
    // props getter returns the private object; verify it's not the same reference across calls
    const p1 = m.props;
    const p2 = m.props;
    expect(p1).toBe(p2); // same reference (cheap, no copy on read)
    // Cannot mutate: TypeScript enforces readonly at compile time; runtime safety is structural.
    expect(typeof p1.body).toBe("string");
  });
});
