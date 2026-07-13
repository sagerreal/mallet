import { describe, it, expect } from "vitest";
import { asOrgId, asQuotingRuleId, isOk } from "@mallet/shared/types";
import { QuotingRule, RULE_MAX_LENGTH, type QuotingRuleProps } from "./quoting-rule";

const NOW = new Date("2026-07-13T12:00:00Z");
const LATER = new Date("2026-07-13T13:00:00Z");

const baseProps = (over: Partial<QuotingRuleProps> = {}): QuotingRuleProps => ({
  id: asQuotingRuleId("00000000-0000-0000-0000-000000000001"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  rule: "Add an expansion tank on closed systems",
  serviceId: null,
  jobTag: "water heater",
  status: "proposed",
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

const mustCreate = (over: Partial<QuotingRuleProps> = {}): QuotingRule => {
  const result = QuotingRule.create(baseProps(over));
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
};

describe("QuotingRule.create", () => {
  it("creates a valid rule and trims text", () => {
    const rule = mustCreate({ rule: "  Add haul-away on tank swaps  " });
    expect(rule.props.rule).toBe("Add haul-away on tank swaps");
    expect(rule.isActive()).toBe(true);
  });

  it("rejects empty rule text", () => {
    expect(QuotingRule.create(baseProps({ rule: "   " })).ok).toBe(false);
  });

  it(`rejects rules over ${RULE_MAX_LENGTH} chars`, () => {
    expect(QuotingRule.create(baseProps({ rule: "x".repeat(RULE_MAX_LENGTH + 1) })).ok).toBe(false);
  });

  it("rejects unknown status and source", () => {
    expect(QuotingRule.create(baseProps({ status: "live" as never })).ok).toBe(false);
    expect(QuotingRule.create(baseProps({ source: "llm" as never })).ok).toBe(false);
  });

  it("rejects a non-positive timesConfirmed", () => {
    expect(QuotingRule.create(baseProps({ timesConfirmed: 0 })).ok).toBe(false);
    expect(QuotingRule.create(baseProps({ timesConfirmed: 1.5 })).ok).toBe(false);
  });

  it("normalises a blank job tag to null and rejects an oversized one", () => {
    expect(mustCreate({ jobTag: "  " }).props.jobTag).toBeNull();
    expect(QuotingRule.create(baseProps({ jobTag: "x".repeat(101) })).ok).toBe(false);
  });
});

describe("QuotingRule transitions", () => {
  it("confirm flips proposed → confirmed on a NEW instance", () => {
    const rule = mustCreate();
    const confirmed = rule.confirm(LATER);
    expect(isOk(confirmed) && confirmed.value.props.status).toBe("confirmed");
    expect(rule.props.status).toBe("proposed"); // original untouched
  });

  it("confirm is idempotent (same instance back)", () => {
    const rule = mustCreate({ status: "confirmed" });
    const again = rule.confirm(LATER);
    expect(isOk(again) && again.value).toBe(rule);
  });

  it("confirm rejects an invalidated rule", () => {
    const rule = mustCreate({ invalidatedAt: NOW });
    expect(rule.confirm(LATER).ok).toBe(false);
  });

  it("invalidate stamps invalidatedAt + supersededBy and is idempotent", () => {
    const rule = mustCreate({ status: "confirmed" });
    const successor = asQuotingRuleId("00000000-0000-0000-0000-000000000002");
    const dead = rule.invalidate(LATER, successor);
    expect(dead.props.invalidatedAt).toEqual(LATER);
    expect(dead.props.supersededBy).toBe(successor);
    expect(dead.isActive()).toBe(false);
    expect(dead.invalidate(LATER)).toBe(dead); // idempotent
  });

  it("bump increments timesConfirmed immutably", () => {
    const rule = mustCreate();
    const bumped = rule.bump(LATER);
    expect(bumped.props.timesConfirmed).toBe(2);
    expect(rule.props.timesConfirmed).toBe(1);
  });
});
