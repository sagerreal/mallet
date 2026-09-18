import { describe, it, expect } from "vitest";
import { isOk, asOrgId, asLeadId, asUserId, asOutboundCallId, asPhone } from "@mallet/shared/types";
import { OutboundCall, type OutboundCallProps } from "./outbound-call";

// ── constants ──────────────────────────────────────────────────────────────
const NOW = new Date("2026-07-24T17:00:00Z");
const LATER = new Date("2026-07-24T17:03:20Z"); // NOW + 200s

// ── helpers ────────────────────────────────────────────────────────────────
const baseProps = (overrides: Partial<OutboundCallProps> = {}): OutboundCallProps => ({
  id: asOutboundCallId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  placedByUserId: asUserId("44444444-4444-4444-4444-444444444444"),
  toNumber: asPhone("+19415550134"),
  fromNumber: asPhone("+16693413343"),
  agentNumber: asPhone("+17813850591"),
  transport: "phone" as const,
  status: "queued",
  providerCallSid: null,
  startedAt: null,
  endedAt: null,
  durationSec: null,
  outcome: null,
  notes: "",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const build = (overrides: Partial<OutboundCallProps> = {}): OutboundCall => {
  const r = OutboundCall.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// ── create ─────────────────────────────────────────────────────────────────
describe("OutboundCall.create", () => {
  it("creates a queued call with no provider SID and empty notes", () => {
    const r = OutboundCall.create(baseProps());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("queued");
      expect(r.value.props.providerCallSid).toBeNull();
      expect(r.value.props.notes).toBe("");
    }
  });

  it("refuses a call whose agent number equals the customer number (self-bridge would loop)", () => {
    const r = OutboundCall.create(baseProps({ agentNumber: asPhone("+19415550134") }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.field).toBe("agentNumber");
    }
  });

  it("trims notes so whitespace-only notes normalise to empty", () => {
    const call = build({ notes: "   " });
    expect(call.props.notes).toBe("");
  });
});

// ── markDialing ────────────────────────────────────────────────────────────
describe("OutboundCall.markDialing", () => {
  it("records the provider SID and moves queued → dialing", () => {
    const r = build().markDialing("CA123", LATER);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("dialing");
      expect(r.value.props.providerCallSid).toBe("CA123");
      expect(r.value.props.updatedAt).toEqual(LATER);
    }
  });

  it("does not mutate the original (immutability)", () => {
    const call = build();
    call.markDialing("CA123", LATER);
    expect(call.props.status).toBe("queued");
    expect(call.props.providerCallSid).toBeNull();
  });

  it("rejects an empty provider SID rather than storing a blank the webhook can never match", () => {
    const r = build().markDialing("  ", LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("providerCallSid");
  });

  it("refuses to re-dial a call that already reached a terminal status", () => {
    const done = build({ status: "completed" });
    const r = done.markDialing("CA999", LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });
});

// ── applyProviderStatus ────────────────────────────────────────────────────
describe("OutboundCall.applyProviderStatus", () => {
  it.each([
    ["queued", "dialing"],
    ["initiated", "dialing"],
    ["ringing", "dialing"],
    ["in-progress", "in_progress"],
    ["completed", "completed"],
    ["busy", "busy"],
    ["no-answer", "no_answer"],
    ["failed", "failed"],
    ["canceled", "canceled"],
  ])("maps Twilio %s → %s", (provider, expected) => {
    const r = build({ status: "dialing" }).applyProviderStatus(provider, null, LATER);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.status).toBe(expected);
  });

  it("stamps startedAt when the bridge connects", () => {
    const r = build({ status: "dialing" }).applyProviderStatus("in-progress", null, LATER);
    expect(isOk(r) && r.value.props.startedAt).toEqual(LATER);
  });

  it("stamps endedAt and duration when the call completes", () => {
    const r = build({ status: "in_progress", startedAt: NOW }).applyProviderStatus("completed", 200, LATER);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.endedAt).toEqual(LATER);
      expect(r.value.props.durationSec).toBe(200);
    }
  });

  it("rejects an unknown provider status instead of silently ignoring it", () => {
    const r = build({ status: "dialing" }).applyProviderStatus("teleported", null, LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("rejects a negative duration", () => {
    const r = build({ status: "in_progress" }).applyProviderStatus("completed", -5, LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("durationSec");
  });

  it("ignores a late duplicate webhook once terminal (stays completed, keeps first endedAt)", () => {
    const done = build({ status: "completed", endedAt: LATER, durationSec: 200 });
    const r = done.applyProviderStatus("completed", 999, new Date("2026-07-24T18:00:00Z"));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.endedAt).toEqual(LATER);
      expect(r.value.props.durationSec).toBe(200);
    }
  });
});

// ── logOutcome ─────────────────────────────────────────────────────────────
describe("OutboundCall.logOutcome", () => {
  it("stores the disposition and trimmed notes", () => {
    const r = build({ status: "completed" }).logOutcome("Booked", "  wants Tuesday  ", LATER);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.outcome).toBe("Booked");
      expect(r.value.props.notes).toBe("wants Tuesday");
    }
  });

  it("rejects a blank outcome", () => {
    const r = build({ status: "completed" }).logOutcome("   ", "", LATER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("outcome");
  });

  // The two transports are mutually exclusive in shape, and the shape is what tells them apart in
  // the database. Allowing either mismatch would mean a row that claims a leg it never had.
  describe("transport invariants", () => {
    it("refuses a phone call with no number to ring", () => {
      const r = OutboundCall.create({ ...baseProps(), transport: "phone", agentNumber: null });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("agentNumber");
    });

    it("refuses a browser call that carries a number to ring", () => {
      const r = OutboundCall.create({ ...baseProps(), transport: "browser" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("agentNumber");
    });

    it("accepts a browser call with no number", () => {
      expect(OutboundCall.create({ ...baseProps(), transport: "browser", agentNumber: null }).ok).toBe(true);
    });
  });
});
