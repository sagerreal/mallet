/**
 * lib/store/visit-stamps.test.ts
 *
 * THE BUG THIS FILE EXISTS FOR: the stepper reads status and stamps together, so an optimistic
 * update that moved the status without recording the stamp rendered "On the way — skipped" about
 * a tap the technician had just made. Two taps in quick succession were enough.
 *
 * And the rule it must not break while fixing that: a step nobody took stays skipped.
 */
import { describe, it, expect } from "vitest";
import { optimisticVisit } from "./visit-stamps";
import { visitSteps } from "@/components/modals/tech-job-modal/visit-steps";
import type { Visit } from "./types";

const AT = new Date(2026, 7, 4, 14, 41, 0);
const LATER = new Date(2026, 7, 4, 14, 58, 0);

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-08-04",
  techId: "tech-1",
  start: 15,
  dur: 2,
  status: "scheduled",
  ...over,
});

describe("optimisticVisit", () => {
  it("stamps the drive when the drive is started", () => {
    const next = optimisticVisit(visit(), "enroute", AT);
    expect(next.status).toBe("enroute");
    expect(next.enrouteAt).toBe(AT.toISOString());
    expect(next.startedAt).toBeUndefined();
  });

  // There is no `arrived_at` column: `started_at` IS the arrival stamp.
  it("stamps the arrival on startedAt", () => {
    const next = optimisticVisit(visit({ status: "enroute", enrouteAt: AT.toISOString() }), "onsite", LATER);
    expect(next.startedAt).toBe(LATER.toISOString());
  });

  it("stamps the finish", () => {
    const next = optimisticVisit(visit({ status: "onsite" }), "done", LATER);
    expect(next.completedAt).toBe(LATER.toISOString());
  });

  // A re-tap is not a new arrival, and ↩ Reopen is the server's answer to give.
  it("never overwrites a stamp the visit already carries", () => {
    const next = optimisticVisit(visit({ status: "enroute", enrouteAt: AT.toISOString() }), "enroute", LATER);
    expect(next.enrouteAt).toBe(AT.toISOString());
  });

  it("stamps nothing on ↩ Reopen", () => {
    const done = visit({ status: "done", enrouteAt: AT.toISOString(), completedAt: LATER.toISOString() });
    expect(optimisticVisit(done, "scheduled", LATER)).toEqual({ ...done, status: "scheduled" });
  });

  // THE OTHER HALF OF THE RULE. Finishing straight from scheduled records no drive and no
  // arrival, and must not invent them.
  it("backfills nothing when a step is genuinely skipped", () => {
    const next = optimisticVisit(visit(), "done", AT);
    expect(next.enrouteAt).toBeUndefined();
    expect(next.startedAt).toBeUndefined();
  });
});

// Asserted through the stepper itself, because the defect was only ever visible there.
describe("what the stepper reads mid-flight", () => {
  it("two taps before the first DTO lands: neither step reads as skipped", () => {
    const arrived = optimisticVisit(optimisticVisit(visit(), "enroute", AT), "onsite", LATER);
    const finished = optimisticVisit(arrived, "done", LATER);

    expect(visitSteps(finished).map((s) => s.state)).toEqual(["reached", "reached", "reached", "reached"]);
    expect(visitSteps(finished)[1]?.time).toBe("2:41p");
    expect(visitSteps(finished)[2]?.time).toBe("2:58p");
  });

  // The regression guard: without a stamp this is exactly the lie — "On the way — skipped",
  // reported about a tap made one second earlier.
  it("status without a stamp is the lie, and is no longer what the store writes", () => {
    const statusOnly: Visit = { ...visit(), status: "onsite" };
    expect(visitSteps(statusOnly)[1]?.state).toBe("skipped");

    const stamped = optimisticVisit(optimisticVisit(visit(), "enroute", AT), "onsite", LATER);
    expect(visitSteps(stamped)[1]?.state).toBe("reached");
  });

  it("finishing straight from scheduled still shows both middle steps skipped", () => {
    const finished = optimisticVisit(visit(), "done", AT);
    expect(visitSteps(finished).map((s) => s.state)).toEqual(["reached", "skipped", "skipped", "reached"]);
  });
});
