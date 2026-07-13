import { describe, it, expect } from "vitest";
import { asOrgId, asQuotingRuleId, asServiceId } from "@mallet/shared/types";
import { QuotingRule, type QuotingRuleProps } from "./quoting-rule";
import { matchRules, scopesOverlap, type RuleCandidate } from "./rule-match";

const NOW = new Date("2026-07-13T12:00:00Z");
let seq = 0;

const rule = (over: Partial<QuotingRuleProps> = {}): QuotingRule => {
  seq += 1;
  const result = QuotingRule.create({
    id: asQuotingRuleId(`00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`),
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    rule: "Add an expansion tank on closed systems",
    serviceId: null,
    jobTag: null,
    status: "confirmed",
    source: "manual",
    authorUserId: null,
    sourceEstimateId: null,
    timesConfirmed: 1,
    validFrom: NOW,
    invalidatedAt: null,
    supersededBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const cand = (r: QuotingRule, serviceName: string | null = null): RuleCandidate => ({
  rule: r,
  serviceName,
});

describe("matchRules", () => {
  it("matches by job-tag keyword overlap", () => {
    const heater = cand(rule({ jobTag: "water heater" }));
    const sewer = cand(rule({ jobTag: "sewer line" }));
    const out = matchRules("40-gal gas water heater swap", [heater, sewer]);
    expect(out).toEqual([heater]);
  });

  it("matches by the scoped service's name", () => {
    const scoped = cand(rule({ serviceId: asServiceId("00000000-0000-0000-0000-0000000000aa") }), "Water Heater Swap");
    expect(matchRules("replace the water heater", [scoped])).toEqual([scoped]);
    expect(matchRules("clear a sewer blockage", [scoped])).toEqual([]);
  });

  it("unscoped rules always apply (shop-wide)", () => {
    const general = cand(rule({ jobTag: null }));
    expect(matchRules("anything at all", [general])).toEqual([general]);
  });

  it("orders by timesConfirmed desc and caps at the limit", () => {
    const weak = cand(rule({ jobTag: "heater", timesConfirmed: 1 }));
    const strong = cand(rule({ jobTag: "heater", timesConfirmed: 5 }));
    const out = matchRules("heater swap", [weak, strong], 1);
    expect(out).toEqual([strong]);
  });
});

describe("scopesOverlap", () => {
  const SVC = "00000000-0000-0000-0000-0000000000aa";

  it("same service overlaps; different services do not", () => {
    expect(scopesOverlap({ serviceId: SVC, jobTag: null }, { serviceId: SVC, jobTag: null })).toBe(true);
    expect(
      scopesOverlap(
        { serviceId: SVC, jobTag: null },
        { serviceId: "00000000-0000-0000-0000-0000000000bb", jobTag: null },
      ),
    ).toBe(false);
  });

  it("shared job-tag keyword overlaps", () => {
    expect(
      scopesOverlap({ serviceId: null, jobTag: "water heater" }, { serviceId: null, jobTag: "heater install" }),
    ).toBe(true);
    expect(
      scopesOverlap({ serviceId: null, jobTag: "water heater" }, { serviceId: null, jobTag: "sewer camera" }),
    ).toBe(false);
  });

  it("two unscoped rules coexist (no overlap)", () => {
    expect(scopesOverlap({ serviceId: null, jobTag: null }, { serviceId: null, jobTag: null })).toBe(false);
  });
});
