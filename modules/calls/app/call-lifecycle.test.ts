import { describe, it, expect, beforeEach } from "vitest";
import {
  isOk,
  asOrgId,
  asLeadId,
  asUserId,
  asOutboundCallId,
  asPhone,
  FixedClock,
  type OutboundCallId,
} from "@mallet/shared/types";
import { OutboundCall, type OutboundCallProps } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";
import { ApplyCallStatusUseCase } from "./apply-call-status";
import { LogCallOutcomeUseCase } from "./log-call-outcome";

// ── constants ──────────────────────────────────────────────────────────────
const NOW = new Date("2026-07-24T17:00:00Z");
const LATER = new Date("2026-07-24T17:05:00Z");
const CALL_ID = asOutboundCallId("11111111-1111-1111-1111-111111111111");
const SID = "CA123";

// ── helpers ────────────────────────────────────────────────────────────────
const props = (o: Partial<OutboundCallProps> = {}): OutboundCallProps => ({
  id: CALL_ID,
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  placedByUserId: asUserId("44444444-4444-4444-4444-444444444444"),
  toNumber: asPhone("+19415550134"),
  fromNumber: asPhone("+16693413343"),
  agentNumber: asPhone("+17813850591"),
  status: "dialing",
  providerCallSid: SID,
  startedAt: null,
  endedAt: null,
  durationSec: null,
  outcome: null,
  notes: "",
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
});

const build = (o: Partial<OutboundCallProps> = {}): OutboundCall => {
  const r = OutboundCall.create(props(o));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

class FakeRepo implements OutboundCallRepository {
  public rows = new Map<string, OutboundCall>();
  public saveReturnsNull = false;
  constructor(seed?: OutboundCall) {
    if (seed) this.rows.set(seed.props.id, seed);
  }
  async create(call: OutboundCall): Promise<OutboundCall> {
    this.rows.set(call.props.id, call);
    return call;
  }
  async findById(id: OutboundCallId): Promise<OutboundCall | null> {
    return this.rows.get(id) ?? null;
  }
  async findByProviderSid(sid: string): Promise<OutboundCall | null> {
    return [...this.rows.values()].find((c) => c.props.providerCallSid === sid) ?? null;
  }
  async save(call: OutboundCall): Promise<OutboundCall | null> {
    if (this.saveReturnsNull) return null;
    this.rows.set(call.props.id, call);
    return call;
  }
}

// ── ApplyCallStatusUseCase ─────────────────────────────────────────────────
describe("ApplyCallStatusUseCase", () => {
  let clock: FixedClock;
  beforeEach(() => {
    clock = new FixedClock(LATER);
  });

  it("moves the call to in_progress when the bridge connects", async () => {
    const repo = new FakeRepo(build());
    const r = await new ApplyCallStatusUseCase(repo, clock).exec({
      providerCallSid: SID,
      providerStatus: "in-progress",
      durationSec: null,
    });
    expect(isOk(r) && r.value.props.status).toBe("in_progress");
  });

  it("records duration on completion", async () => {
    const repo = new FakeRepo(build({ status: "in_progress", startedAt: NOW }));
    const r = await new ApplyCallStatusUseCase(repo, clock).exec({
      providerCallSid: SID,
      providerStatus: "completed",
      durationSec: 300,
    });
    expect(isOk(r) && r.value.props.durationSec).toBe(300);
  });

  it("returns not_found for an unknown SID rather than creating a row", async () => {
    const repo = new FakeRepo();
    const r = await new ApplyCallStatusUseCase(repo, clock).exec({
      providerCallSid: "CA-nope",
      providerStatus: "completed",
      durationSec: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
    expect(repo.rows.size).toBe(0);
  });

  it("rejects an unknown provider status", async () => {
    const repo = new FakeRepo(build());
    const r = await new ApplyCallStatusUseCase(repo, clock).exec({
      providerCallSid: SID,
      providerStatus: "sideways",
      durationSec: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });
});

// ── LogCallOutcomeUseCase ──────────────────────────────────────────────────
describe("LogCallOutcomeUseCase", () => {
  let clock: FixedClock;
  beforeEach(() => {
    clock = new FixedClock(LATER);
  });

  it("persists the disposition and notes so the log survives a refresh", async () => {
    const repo = new FakeRepo(build({ status: "completed" }));
    const r = await new LogCallOutcomeUseCase(repo, clock).exec({
      callId: CALL_ID,
      outcome: "Booked",
      notes: "wants Tuesday AM",
    });
    expect(isOk(r)).toBe(true);
    expect(repo.rows.get(CALL_ID)?.props.outcome).toBe("Booked");
    expect(repo.rows.get(CALL_ID)?.props.notes).toBe("wants Tuesday AM");
  });

  it("returns not_found for a call in another tenant (RLS makes it invisible)", async () => {
    const r = await new LogCallOutcomeUseCase(new FakeRepo(), clock).exec({
      callId: CALL_ID,
      outcome: "Booked",
      notes: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("surfaces not_found when the row vanishes between read and write", async () => {
    const repo = new FakeRepo(build({ status: "completed" }));
    repo.saveReturnsNull = true;
    const r = await new LogCallOutcomeUseCase(repo, clock).exec({
      callId: CALL_ID,
      outcome: "Booked",
      notes: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("rejects a blank outcome", async () => {
    const repo = new FakeRepo(build({ status: "completed" }));
    const r = await new LogCallOutcomeUseCase(repo, clock).exec({
      callId: CALL_ID,
      outcome: "  ",
      notes: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });
});
