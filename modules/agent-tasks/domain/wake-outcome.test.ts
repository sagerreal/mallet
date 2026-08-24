import { describe, it, expect } from "vitest";
import { asAgentTaskId, asOrgId, asUserId, isOk, type OrgId } from "@mallet/shared/types";
import { AgentTask, type AgentTaskProps } from "./agent-task";
import {
  applyDecision, classifyTurnFailure, dispositionOf, TickBudgetExceeded, TICK_BUDGET_ERROR,
} from "./wake-outcome";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-20T17:00:00Z");
const AT = new Date("2026-08-21T17:00:00Z");

const built = (over: Partial<AgentTaskProps> = {}): AgentTask => {
  const r = AgentTask.create({
    id: asAgentTaskId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
    orgId: ORG,
    title: "Chase the Hendersons",
    status: "working",
    nextActionAt: null,
    nextActionNote: null,
    origin: "chat",
    createdBy: asUserId("11111111-1111-4111-8111-111111111111"),
    createdByRole: "owner",
    version: 0,
    attempts: 0,
    lastError: null,
    leaseId: null,
    lockedUntil: null,
    transcriptBytes: 0,
    stepsTaken: 0,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  });
  if (!isOk(r)) throw new Error(`fixture invalid: ${r.error.message}`);
  return r.value;
};

// LlmError's own shape, rebuilt structurally: a domain unit test cannot import the @mallet/ai
// barrel as a VALUE (it pulls the tRPC router and the config validator, which throws with no env).
// That the predicate matches the real class is proven by the runner's integration tests, which
// drive it with a live `new LlmError(true)` / `new LlmError(false)`.
const llmError = (retryable: boolean): Error =>
  Object.assign(new Error("the assistant is temporarily unavailable"), { name: "LlmError", retryable });

describe("classifyTurnFailure", () => {
  it("backs off a retryable provider failure", () => {
    expect(classifyTurnFailure(llmError(true))).toBe("back_off");
  });

  it("treats a NON-retryable provider failure as a real failure", () => {
    expect(classifyTurnFailure(llmError(false))).toBe("fail");
  });

  it("ignores a look-alike that is not really the provider error", () => {
    expect(classifyTurnFailure({ name: "LlmError", retryable: true })).toBe("fail");
    expect(classifyTurnFailure(Object.assign(new Error("x"), { name: "LlmError" }))).toBe("fail");
  });

  it("abandons the wake when the tick ran out of its own budget", () => {
    expect(classifyTurnFailure(new TickBudgetExceeded())).toBe("abandon");
  });

  it("treats anything else as a real failure", () => {
    expect(classifyTurnFailure(new Error("pool timeout"))).toBe("fail");
    expect(classifyTurnFailure("not even an error")).toBe("fail");
  });

  it("carries a PII-free discriminator for the budget case", () => {
    expect(TICK_BUDGET_ERROR).toBe("tick_budget");
    expect(new TickBudgetExceeded().name).toBe("TickBudgetExceeded");
  });
});

describe("applyDecision", () => {
  it("schedules", () => {
    const r = applyDecision(built(), { kind: "schedule", at: AT, note: "call back" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.nextActionAt).toBe(AT);
  });

  it("finishes", () => {
    const r = applyDecision(built(), { kind: "finish", summary: "sorted" }, NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.status).toBe("done");
  });

  it("hands over, and cannot fail even on a terminal task", () => {
    const r = applyDecision(built({ status: "done" }), { kind: "hand_over", note: "over to you" }, NOW);
    expect(isOk(r)).toBe(true);
    // Terminal is absorbing: the same instance comes back rather than being un-finished.
    if (isOk(r)) expect(r.value.props.status).toBe("done");
  });

  it("surfaces the aggregate's refusal for a schedule or a finish on a terminal task", () => {
    expect(isOk(applyDecision(built({ status: "closed" }), { kind: "schedule", at: AT, note: "x" }, NOW))).toBe(false);
    expect(isOk(applyDecision(built({ status: "done" }), { kind: "finish", summary: "x" }, NOW))).toBe(false);
  });
});

describe("dispositionOf", () => {
  it("names each decision the way the tick summary counts it", () => {
    expect(dispositionOf({ kind: "schedule", at: AT, note: "n" })).toBe("scheduled");
    expect(dispositionOf({ kind: "finish", summary: "s" })).toBe("finished");
    expect(dispositionOf({ kind: "hand_over", note: "n" })).toBe("handedOver");
  });
});
