import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asEstimateId,
  asServiceId,
  FixedClock,
  isOk,
  type OrgId,
  type EstimateId,
  type QuotingRuleId,
} from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import type { ServiceNameEntry, ServiceNameReader } from "../domain/service-name-reader";
import { matchRules, type RuleCandidate } from "../domain/rule-match";
import type { AiDraftSnapshot, SentLineView } from "../domain/edit-delta";
import { MineEditDeltasUseCase, type MineEditDeltasCommand } from "./mine-edit-deltas";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const EST_1 = asEstimateId("55555555-5555-5555-5555-555555555551");
const EST_2 = asEstimateId("55555555-5555-5555-5555-555555555552");
const NOW = new Date("2026-07-13T12:00:00Z");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

class FakeQuotingRuleRepository implements QuotingRuleRepository {
  readonly store = new Map<QuotingRuleId, QuotingRule>();

  async save(rule: QuotingRule): Promise<void> {
    this.store.set(rule.props.id, rule);
  }
  async findById(id: QuotingRuleId): Promise<QuotingRule | null> {
    return this.store.get(id) ?? null;
  }
  async listConfirmed(): Promise<QuotingRule[]> {
    return [...this.store.values()].filter((r) => r.props.status === "confirmed" && r.isActive());
  }
  async listProposed(): Promise<QuotingRule[]> {
    return [...this.store.values()].filter(
      (r) =>
        r.props.status === "proposed" &&
        r.isActive() &&
        (r.props.source !== "edit_delta" || r.props.timesConfirmed >= 2),
    );
  }
  async findMatching(jobText: string, limit?: number): Promise<RuleCandidate[]> {
    const candidates = (await this.listConfirmed()).map((rule) => ({ rule, serviceName: null }));
    return matchRules(jobText, candidates, limit);
  }
  async listProposedEditDeltas(): Promise<QuotingRule[]> {
    return [...this.store.values()].filter(
      (r) => r.props.status === "proposed" && r.props.source === "edit_delta" && r.isActive(),
    );
  }
}

class FakeServiceNameReader implements ServiceNameReader {
  constructor(private readonly entries: ServiceNameEntry[] = []) {}
  async listActiveNames(): Promise<ServiceNameEntry[]> {
    return this.entries;
  }
}

const snapshot = (rateCents: number, quantity = 10): AiDraftSnapshot => ({
  lines: [{ description: "Water heater swap labor", quantity, rateCents }],
  at: NOW.toISOString(),
});

const sentLines = (rateCents: number, quantity = 10): SentLineView[] => [
  { description: "Water heater swap labor", quantity, rateCents, isOptional: false, tier: null },
];

let repo: FakeQuotingRuleRepository;
let miner: MineEditDeltasUseCase;

beforeEach(() => {
  repo = new FakeQuotingRuleRepository();
  miner = new MineEditDeltasUseCase(repo, new FakeServiceNameReader(), new FixedClock(NOW), seqIds());
});

describe("MineEditDeltasUseCase", () => {
  it("a material delta creates ONE proposed edit_delta rule — never confirmed", async () => {
    const result = await miner.exec({
      orgId: ORG,
      estimateId: EST_1,
      snapshot: snapshot(20_000),
      sentLines: sentLines(15_000),
    });
    expect(isOk(result) && result.value).toEqual({ created: 1, bumped: 0 });

    const rules = [...repo.store.values()];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.props.status).toBe("proposed");
    expect(rules[0]!.props.source).toBe("edit_delta");
    expect(rules[0]!.props.timesConfirmed).toBe(1);
    expect(rules[0]!.props.sourceEstimateId).toBe(EST_1);
    // One observation NEVER reaches the review queue.
    expect(await repo.listProposed()).toHaveLength(0);
  });

  it("an equivalent recurrence bumps times_confirmed instead of duplicating — and surfaces at ≥2", async () => {
    await miner.exec({ orgId: ORG, estimateId: EST_1, snapshot: snapshot(20_000), sentLines: sentLines(15_000) });
    const result = await miner.exec({
      orgId: ORG,
      estimateId: EST_2,
      snapshot: snapshot(20_000),
      sentLines: sentLines(16_000),
    });
    expect(isOk(result) && result.value).toEqual({ created: 0, bumped: 1 });

    const rules = [...repo.store.values()];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.props.timesConfirmed).toBe(2);
    // Two independent recurrences → the proposal surfaces in the queue.
    expect(await repo.listProposed()).toHaveLength(1);
  });

  it("the opposite direction is a DIFFERENT proposal (no false corroboration)", async () => {
    await miner.exec({ orgId: ORG, estimateId: EST_1, snapshot: snapshot(20_000), sentLines: sentLines(15_000) });
    const result = await miner.exec({
      orgId: ORG,
      estimateId: EST_2,
      snapshot: snapshot(20_000),
      sentLines: sentLines(30_000),
    });
    expect(isOk(result) && result.value).toEqual({ created: 1, bumped: 0 });
    expect([...repo.store.values()]).toHaveLength(2);
  });

  it("no material deltas → no writes", async () => {
    const result = await miner.exec({
      orgId: ORG,
      estimateId: EST_1,
      snapshot: snapshot(20_000),
      sentLines: sentLines(20_000),
    });
    expect(isOk(result) && result.value).toEqual({ created: 0, bumped: 0 });
    expect(repo.store.size).toBe(0);
  });
});

// The AI phrases the same line differently per estimate — equivalence must not
// require the exact normalized description, or real corroboration never counts.
describe("MineEditDeltasUseCase — recurrence equivalence across wordings", () => {
  // One AI line repriced down 25% by the office (same description within a
  // send, so the differ pairs it exactly; the WORDING varies across sends).
  const priceCut = (description: string, estimateId: EstimateId): MineEditDeltasCommand => ({
    orgId: ORG,
    estimateId,
    snapshot: { lines: [{ description, quantity: 5, rateCents: 20_000 }], at: NOW.toISOString() },
    sentLines: [{ description, quantity: 5, rateCents: 15_000, isOptional: false, tier: null }],
  });

  it("two differently-worded water-heater labor cuts across two jobs bump ONE proposal to times_confirmed 2", async () => {
    await miner.exec(priceCut("Labor — water heater swap", EST_1));
    const result = await miner.exec(priceCut("Water heater swap — labor charge", EST_2));
    expect(isOk(result) && result.value).toEqual({ created: 0, bumped: 1 });

    const rules = [...repo.store.values()];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.props.timesConfirmed).toBe(2);
    expect(await repo.listProposed()).toHaveLength(1);
  });

  it("unrelated tags sharing one generic token stay SEPARATE proposals (<60% overlap)", async () => {
    await miner.exec(priceCut("Water shutoff valve", EST_1));
    const result = await miner.exec(priceCut("Water filtration system", EST_2));
    expect(isOk(result) && result.value).toEqual({ created: 1, bumped: 0 });
    expect([...repo.store.values()]).toHaveLength(2);
  });

  it("same tag but opposite direction never corroborates (different rulePrefix)", async () => {
    await miner.exec(priceCut("Labor — water heater swap", EST_1));
    const result = await miner.exec({
      orgId: ORG,
      estimateId: EST_2,
      snapshot: { lines: [{ description: "Water heater swap labor", quantity: 5, rateCents: 20_000 }], at: NOW.toISOString() },
      sentLines: [{ description: "Water heater swap labor", quantity: 5, rateCents: 30_000, isOptional: false, tier: null }],
    });
    expect(isOk(result) && result.value).toEqual({ created: 1, bumped: 0 });
    expect([...repo.store.values()]).toHaveLength(2);
  });

  it("a line matching a pricebook service anchors the proposal to the service id and bumps by it", async () => {
    const svcId = asServiceId("77777777-7777-7777-7777-777777777777");
    const services = new FakeServiceNameReader([{ id: svcId, name: "Water Heater Swap Labor" }]);
    const svcMiner = new MineEditDeltasUseCase(repo, services, new FixedClock(NOW), seqIds());

    await svcMiner.exec(priceCut("Water heater swap labor", EST_1));
    const rules = [...repo.store.values()];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.props.serviceId).toBe(svcId);

    const result = await svcMiner.exec(priceCut("Water heater swap labor", EST_2));
    expect(isOk(result) && result.value).toEqual({ created: 0, bumped: 1 });
    expect([...repo.store.values()]).toHaveLength(1);
  });
});
