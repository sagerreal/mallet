import { describe, it, expect, beforeEach } from "vitest";
import {
  isOk,
  ok,
  err,
  externalService,
  asOrgId,
  asLeadId,
  asUserId,
  asOutboundCallId,
  asPhone,
  type Phone,
  type LeadId,
  type UserId,
  type OutboundCallId,
  type Result,
  type ExternalServiceError,
} from "@mallet/shared/types";
import { FixedClock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";
import type { CallOriginator, OriginateCallCmd, CallOriginationReceipt } from "../domain/call-originator";
import type { LeadPhoneReader, OrgLineReader, AgentNumberStore } from "../domain/call-directory";
import { PlaceOutboundCallUseCase } from "./place-outbound-call";

// ── constants ──────────────────────────────────────────────────────────────
const NOW = new Date("2026-07-24T17:00:00Z");
const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const USER = asUserId("44444444-4444-4444-4444-444444444444");
const MINTED = "55555555-5555-5555-5555-555555555555";

const CUSTOMER = asPhone("+19415550134");
const BUSINESS = asPhone("+16693413343");
const AGENT = asPhone("+17813850591");

const fixedIds = (): IdGenerator => ({ newId: () => MINTED });

// ── fakes ──────────────────────────────────────────────────────────────────
class FakeCallRepository implements OutboundCallRepository {
  public rows = new Map<string, OutboundCall>();
  public createCount = 0;

  async create(call: OutboundCall): Promise<OutboundCall> {
    this.createCount += 1;
    this.rows.set(call.props.id, call);
    return call;
  }
  async findById(id: OutboundCallId): Promise<OutboundCall | null> {
    return this.rows.get(id) ?? null;
  }
  async findByProviderSid(): Promise<OutboundCall | null> {
    throw new Error("findByProviderSid not used in place tests");
  }
  async save(call: OutboundCall): Promise<OutboundCall | null> {
    if (!this.rows.has(call.props.id)) return null;
    this.rows.set(call.props.id, call);
    return call;
  }
}

class FakeOriginator implements CallOriginator {
  public calls: OriginateCallCmd[] = [];
  constructor(private readonly result: Result<CallOriginationReceipt, ExternalServiceError>) {}
  async originate(cmd: OriginateCallCmd): Promise<Result<CallOriginationReceipt, ExternalServiceError>> {
    this.calls.push(cmd);
    return this.result;
  }
}

const leadReader = (phone: Phone | null): LeadPhoneReader => ({ findPhone: async () => phone });
const orgLine = (phone: Phone | null): OrgLineReader => ({ businessNumber: async () => phone });

class FakeAgentNumbers implements AgentNumberStore {
  public saved: { userId: UserId; number: Phone }[] = [];
  constructor(private stored: Phone | null) {}
  async find(): Promise<Phone | null> {
    return this.stored;
  }
  async save(userId: UserId, number: Phone): Promise<void> {
    this.saved.push({ userId, number });
    this.stored = number;
  }
}

// ── subject ────────────────────────────────────────────────────────────────
describe("PlaceOutboundCallUseCase", () => {
  let repo: FakeCallRepository;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeCallRepository();
    clock = new FixedClock(NOW);
  });

  const build = (opts: {
    originator?: CallOriginator;
    lead?: Phone | null;
    line?: Phone | null;
    agents?: FakeAgentNumbers;
  } = {}) => {
    const agents = opts.agents ?? new FakeAgentNumbers(AGENT);
    const originator = opts.originator ?? new FakeOriginator(ok({ providerCallSid: "CA123" }));
    const useCase = new PlaceOutboundCallUseCase(
      repo,
      originator,
      leadReader(opts.lead === undefined ? CUSTOMER : opts.lead),
      orgLine(opts.line === undefined ? BUSINESS : opts.line),
      agents,
      fixedIds(),
      clock,
    );
    return { useCase, agents, originator };
  };

  const cmd = (agentNumber?: string) => ({ orgId: ORG, leadId: LEAD, placedByUserId: USER, agentNumber });

  it("persists the call BEFORE asking the provider to dial (a placed call always has a row)", async () => {
    const { useCase, originator } = build();
    await useCase.exec(cmd());
    // The fake records the row at create(); the originator only ever sees an id that exists.
    const fake = originator as FakeOriginator;
    expect(repo.createCount).toBe(1);
    expect(repo.rows.has(fake.calls[0]!.callId)).toBe(true);
  });

  it("never hands the customer's number to the provider (no open-relay dialling)", async () => {
    const { useCase, originator } = build();
    await useCase.exec(cmd());
    const sent = (originator as FakeOriginator).calls[0]!;
    expect(sent.agentNumber).toBe(AGENT);
    expect(sent.fromNumber).toBe(BUSINESS);
    expect(JSON.stringify(sent)).not.toContain("9415550134");
  });

  it("records the provider SID and returns a dialing call", async () => {
    const { useCase } = build();
    const r = await useCase.exec(cmd());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("dialing");
      expect(r.value.props.providerCallSid).toBe("CA123");
      expect(r.value.props.toNumber).toBe(CUSTOMER);
    }
  });

  it("marks the call failed and surfaces the error when the provider refuses", async () => {
    const { useCase } = build({
      originator: new FakeOriginator(err(externalService("twilio", "voice unavailable", true))),
    });
    const r = await useCase.exec(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
    const stored = repo.rows.get(asOutboundCallId(MINTED));
    expect(stored?.props.status).toBe("failed");
  });

  it("refuses when the lead has no phone on file", async () => {
    const { useCase, originator } = build({ lead: null });
    const r = await useCase.exec(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect((originator as FakeOriginator).calls).toHaveLength(0);
    expect(repo.createCount).toBe(0);
  });

  it("refuses when the org has no business line provisioned", async () => {
    const { useCase, originator } = build({ line: null });
    const r = await useCase.exec(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
    expect((originator as FakeOriginator).calls).toHaveLength(0);
  });

  it("refuses when the caller has no callback number stored and supplies none", async () => {
    const { useCase } = build({ agents: new FakeAgentNumbers(null) });
    const r = await useCase.exec(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });

  it("remembers a newly supplied callback number so it is not retyped next time", async () => {
    const agents = new FakeAgentNumbers(null);
    const { useCase } = build({ agents });
    const r = await useCase.exec(cmd("(781) 385-0591"));
    expect(isOk(r)).toBe(true);
    expect(agents.saved).toHaveLength(1);
    expect(agents.saved[0]!.number).toBe(AGENT);
  });

  it("does not re-save a supplied number that already matches the stored one", async () => {
    const agents = new FakeAgentNumbers(AGENT);
    const { useCase } = build({ agents });
    await useCase.exec(cmd("781-385-0591"));
    expect(agents.saved).toHaveLength(0);
  });

  it("rejects an unparseable supplied callback number", async () => {
    const { useCase } = build();
    const r = await useCase.exec(cmd("12"));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("phone");
  });

  it("refuses to bridge a customer to their own number", async () => {
    const { useCase } = build({ lead: AGENT });
    const r = await useCase.exec(cmd());
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "validation") expect(r.error.field).toBe("agentNumber");
  });
});
