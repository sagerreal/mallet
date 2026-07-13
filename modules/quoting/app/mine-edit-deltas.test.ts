import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asEstimateId,
  FixedClock,
  isOk,
  type OrgId,
  type QuotingRuleId,
} from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { QuotingRule } from "../domain/quoting-rule";
import type { QuotingRuleRepository } from "../domain/quoting-rule-repository";
import { matchRules, type RuleCandidate } from "../domain/rule-match";
import type { AiDraftSnapshot, SentLineView } from "../domain/edit-delta";
import { MineEditDeltasUseCase } from "./mine-edit-deltas";

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
  async listProposedEditDeltasByTag(jobTag: string): Promise<QuotingRule[]> {
    return [...this.store.values()].filter(
      (r) =>
        r.props.status === "proposed" &&
        r.props.source === "edit_delta" &&
        r.props.jobTag === jobTag &&
        r.isActive(),
    );
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
  miner = new MineEditDeltasUseCase(repo, new FixedClock(NOW), seqIds());
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
