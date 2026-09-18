import { describe, it, expect } from "vitest";
import { explainSyncProblem } from "./sync-problem";
import { UNMAPPED_EMPLOYEE, BREAK_NOT_PAID } from "./time-activity-mapping";

describe("explainSyncProblem", () => {
  it("says nothing about a success — there is no problem to describe", () => {
    expect(explainSyncProblem("succeeded", null)).toBeNull();
    // Even if a code somehow rode along, a succeeded row is not a fault.
    expect(explainSyncProblem("succeeded", UNMAPPED_EMPLOYEE)).toBeNull();
  });

  it("names both the cause and the next action for a known code", () => {
    const p = explainSyncProblem("failed", UNMAPPED_EMPLOYEE);
    expect(p?.says).toMatch(/isn't matched to anyone in QuickBooks/i);
    expect(p?.fix).toMatch(/Match your crew/i);
    expect(p?.retryable).toBe(true);
  });

  // A break is the rule working, not a fault — offering a retry would invite someone to
  // keep pressing a button that is supposed to do nothing.
  it("treats an unpaid break as normal, with no fix and no retry", () => {
    const p = explainSyncProblem("skipped", BREAK_NOT_PAID);
    expect(p?.says).toMatch(/isn't paid time/i);
    expect(p?.fix).toBeNull();
    expect(p?.retryable).toBe(false);
  });

  it("explains an AppError kind that escaped a QuickBooks call", () => {
    expect(explainSyncProblem("failed", "unauthorized")?.fix).toMatch(/Reconnect/i);
    expect(explainSyncProblem("failed", "external_service")?.says).toMatch(/didn't answer/i);
  });

  /**
   * The important one. An unrecognised code must still produce a visible row: the whole point of
   * this screen is that a failure is never invisible, and "we have no friendly name for this" is
   * not a reason to hide that somebody's hours did not arrive.
   */
  it("still explains a code it has never seen, and lets it be retried", () => {
    const p = explainSyncProblem("failed", "some_new_code_from_intuit");
    expect(p).not.toBeNull();
    expect(p?.code).toBe("some_new_code_from_intuit");
    expect(p?.says).toMatch(/didn't reach QuickBooks/i);
    expect(p?.retryable).toBe(true);
  });

  it("handles a failure that carried no code at all", () => {
    expect(explainSyncProblem("failed", null)?.code).toBe("unknown");
  });

  // Codes arrive from the database as free text; a key that collides with Object.prototype must
  // not resolve to a function and be rendered as one.
  it("does not mistake an inherited property for an explanation", () => {
    const p = explainSyncProblem("failed", "constructor");
    expect(p?.says).toMatch(/didn't reach QuickBooks/i);
  });
});
