/**
 * The stepper's contract, and the one rule in it that matters: a step nobody recorded renders as
 * SKIPPED with no time. "✓ Mark done" has always worked straight from scheduled, and the server
 * leaves enroute_at / started_at NULL on that path rather than backfilling them. A stepper that
 * filled those in would be inventing an arrival in a record that can end up in a dispute.
 */
import { describe, it, expect } from "vitest";
import { visitSteps, stampLabel } from "./visit-steps";
import type { Visit } from "@/lib/store/types";

const at = (h: number, m: number): string => {
  const d = new Date(2026, 7, 4, h, m, 0);
  return d.toISOString();
};

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: "v1",
  date: "2026-08-04",
  techId: "tech-1",
  start: 15,
  dur: 2,
  status: "scheduled",
  ...over,
});

describe("visitSteps", () => {
  it("nothing tapped: Scheduled is current, the rest are pending and timeless", () => {
    expect(visitSteps(visit())).toEqual([
      { key: "scheduled", label: "Scheduled", state: "current", time: null },
      { key: "enroute", label: "On the way", state: "pending", time: null },
      { key: "onsite", label: "On site", state: "pending", time: null },
    ]);
  });

  it("en route: Scheduled keeps its PLANNED time, On the way is current", () => {
    const steps = visitSteps(visit({ status: "enroute", enrouteAt: at(14, 41) }));
    expect(steps[0]).toEqual({ key: "scheduled", label: "Scheduled", state: "reached", time: "3p" });
    expect(steps[1]?.state).toBe("current");
    // The current node carries no time — the "when" line beneath the stepper says it in full.
    expect(steps[1]?.time).toBeNull();
  });

  it("on site: the two behind it are reached, each with its own recorded stamp", () => {
    const steps = visitSteps(
      visit({ status: "onsite", enrouteAt: at(14, 41), startedAt: at(14, 58) }),
    );
    expect(steps.map((s) => s.state)).toEqual(["reached", "reached", "current"]);
    expect(steps[1]?.time).toBe("2:41p");
  });

  // THE RULE. Finished from scheduled: no stamps were written, so none are shown.
  it("finished with no taps: both middle steps are SKIPPED, with no time on either", () => {
    const steps = visitSteps(visit({ status: "done" }));
    expect(steps.map((s) => s.state)).toEqual(["reached", "skipped", "skipped"]);
    expect(steps[1]?.time).toBeNull();
    expect(steps[2]?.time).toBeNull();
  });

  it("finished having skipped ONLY On my way: the arrival still shows, the drive does not", () => {
    const steps = visitSteps(visit({ status: "done", startedAt: at(14, 58) }));
    expect(steps[1]).toEqual({ key: "enroute", label: "On the way", state: "skipped", time: null });
    expect(steps[2]).toEqual({ key: "onsite", label: "On site", state: "reached", time: "2:58p" });
  });

  // A placed visit WAS scheduled; that node's stamp is the plan, not a tap, so it is never
  // "skipped" — but an unplaced visit has no planned time to print either.
  it("never marks Scheduled skipped, and prints no planned time when there is none", () => {
    const steps = visitSteps(visit({ status: "done", start: null }));
    expect(steps[0]).toEqual({ key: "scheduled", label: "Scheduled", state: "skipped", time: null });
  });
});

describe("stampLabel", () => {
  it("renders an ISO stamp as the app's compact clock", () => {
    expect(stampLabel(at(14, 41))).toBe("2:41p");
  });
  it.each([null, undefined, "not a date"])("answers null for %s rather than a confident wrong time", (v) => {
    expect(stampLabel(v)).toBeNull();
  });
});
