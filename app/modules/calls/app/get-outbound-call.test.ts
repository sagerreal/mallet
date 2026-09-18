import { describe, it, expect } from "vitest";
import {
  isOk,
  asOrgId,
  asLeadId,
  asUserId,
  asOutboundCallId,
  asPhone,
  type OutboundCallId,
} from "@mallet/shared/types";
import { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";
import { GetOutboundCallUseCase } from "./get-outbound-call";

const NOW = new Date("2026-07-25T17:00:00Z");
const CALL = asOutboundCallId("55555555-5555-5555-5555-555555555555");

const aCall = (): OutboundCall => {
  const created = OutboundCall.create({
    id: CALL,
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    placedByUserId: asUserId("44444444-4444-4444-4444-444444444444"),
    toNumber: asPhone("+19415550134"),
    fromNumber: asPhone("+16693413343"),
    agentNumber: asPhone("+17813850591"),
    transport: "phone" as const,
    status: "dialing",
    providerCallSid: "CA123",
    startedAt: null,
    endedAt: null,
    durationSec: null,
    outcome: null,
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
  });
  if (!isOk(created)) throw new Error("fixture failed to build");
  return created.value;
};

class FakeRepo implements OutboundCallRepository {
  constructor(private readonly row: OutboundCall | null) {}
  async create(): Promise<OutboundCall> {
    throw new Error("create not used here");
  }
  async findById(id: OutboundCallId): Promise<OutboundCall | null> {
    return this.row && this.row.props.id === id ? this.row : null;
  }
  async findByProviderSid(): Promise<OutboundCall | null> {
    throw new Error("findByProviderSid not used here");
  }
  async save(): Promise<OutboundCall | null> {
    throw new Error("save not used here");
  }
}

describe("GetOutboundCallUseCase", () => {
  it("returns the call the org owns", async () => {
    const r = await new GetOutboundCallUseCase(new FakeRepo(aCall())).exec(CALL);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.status).toBe("dialing");
  });

  // The repository is org-scoped, so another org's id simply reads as absent — the poll must get a
  // refusal it can stop on, never a row.
  it("refuses with not_found when no such call exists for this org", async () => {
    const r = await new GetOutboundCallUseCase(new FakeRepo(null)).exec(CALL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
