/**
 * The stepper's contract. Two rules matter:
 *
 * 1. A step nobody recorded renders as SKIPPED with no time. "✓ Mark done" has always worked
 *    straight from scheduled, and the server leaves enroute_at / started_at NULL on that path
 *    rather than backfilling them. A stepper that filled those in would be inventing an arrival
 *    in a record that can end up in a dispute. Jumping straight to On site is the same case: the
 *    departure stamp stays null and On the way stays visibly skipped.
 *
 * 2. `jumpTo` is set on the nodes AHEAD of the visit and nowhere else. Forward is a shortcut the
 *    backend already allowed; backward rewrites hours somebody may have been paid for and is the
 *    office's ↩ Reopen, so it must not even be expressible here.
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
      { key: "scheduled", label: "Scheduled", state: "current", time: null, jumpTo: null },
      { key: "enroute", label: "On the way", state: "pending", time: null, jumpTo: "enroute" },
      { key: "onsite", label: "On site", state: "pending", time: null, jumpTo: "onsite" },
      { key: "done", label: "Done", state: "pending", time: null, jumpTo: "done" },
    ]);
  });

  it("en route: Scheduled keeps its PLANNED time, On the way is current", () => {
    const steps = visitSteps(visit({ status: "enroute", enrouteAt: at(14, 41) }));
    expect(steps[0]).toEqual({
      key: "scheduled", label: "Scheduled", state: "reached", time: "3p", jumpTo: null,
    });
    expect(steps[1]?.state).toBe("current");
    // The current node carries no time — the "when" line beneath the stepper says it in full.
    expect(steps[1]?.time).toBeNull();
  });

  it("on site: the two behind it are reached, each with its own recorded stamp", () => {
    const steps = visitSteps(
      visit({ status: "onsite", enrouteAt: at(14, 41), startedAt: at(14, 58) }),
    );
    expect(steps.map((s) => s.state)).toEqual(["reached", "reached", "current", "pending"]);
    expect(steps[1]?.time).toBe("2:41p");
  });

  // THE RULE. Finished from scheduled: no stamps were written, so none are shown.
  it("finished with no taps: both middle steps are SKIPPED, with no time on either", () => {
    const steps = visitSteps(visit({ status: "done" }));
    expect(steps.map((s) => s.state)).toEqual(["reached", "skipped", "skipped", "reached"]);
    expect(steps[1]?.time).toBeNull();
    expect(steps[2]?.time).toBeNull();
  });

  it("finished having skipped ONLY On my way: the arrival still shows, the drive does not", () => {
    const steps = visitSteps(visit({ status: "done", startedAt: at(14, 58) }));
    expect(steps[1]).toEqual({
      key: "enroute", label: "On the way", state: "skipped", time: null, jumpTo: null,
    });
    expect(steps[2]).toEqual({
      key: "onsite", label: "On site", state: "reached", time: "2:58p", jumpTo: null,
    });
  });

  // A placed visit WAS scheduled; that node's stamp is the plan, not a tap, so it is never
  // "skipped" — but an unplaced visit has no planned time to print either.
  it("never marks Scheduled skipped, and prints no planned time when there is none", () => {
    const steps = visitSteps(visit({ status: "done", start: null }));
    expect(steps[0]).toEqual({
      key: "scheduled", label: "Scheduled", state: "skipped", time: null, jumpTo: null,
    });
  });
});

// THE OWNER'S REQUEST. A technician who forgot to tap "Start driving" is standing at the door;
// the foot's ladder offered "I've arrived →" only from enroute, so the one move he needed was the
// one the sheet would not make. Forward jumps are expressible here — and ONLY forward.
describe("visitSteps — forward jumps", () => {
  it("from scheduled, BOTH steps ahead are jumpable — including skipping straight to On site", () => {
    const steps = visitSteps(visit());
    expect(steps.map((s) => s.jumpTo)).toEqual([null, "enroute", "onsite", "done"]);
  });

  it("from enroute, only On site is left to jump to", () => {
    const steps = visitSteps(visit({ status: "enroute", enrouteAt: at(14, 41) }));
    expect(steps.map((s) => s.jumpTo)).toEqual([null, null, "onsite", "done"]);
  });

  // Backwards is not "refused", it is absent: the office's ↩ Reopen is the only way back, because
  // un-finishing a visit rewrites hours somebody may already have been paid for.
  it("on site: only Done is left ahead — everything behind is a step BACKWARDS", () => {
    const steps = visitSteps(visit({ status: "onsite", enrouteAt: at(14, 41), startedAt: at(14, 58) }));
    // Was "nothing is jumpable", which was true only while On site was the last node.
    expect(steps.map((s) => s.jumpTo)).toEqual([null, null, null, "done"]);
  });

  it("done: nothing is jumpable, skipped nodes included", () => {
    const steps = visitSteps(visit({ status: "done" }));
    expect(steps.map((s) => s.state)).toEqual(["reached", "skipped", "skipped", "reached"]);
    expect(steps.every((s) => s.jumpTo === null)).toBe(true);
  });

  // THE STAMP RULE, stated as a test. Jumping to On site writes started_at and leaves enroute_at
  // NULL (SetVisitStatusUseCase.stampsFor), so the node behind must read `skipped` with no time —
  // never a fabricated departure.
  it("after a skipped departure, On the way is SKIPPED with no time — no invented stamp", () => {
    const steps = visitSteps(visit({ status: "onsite", enrouteAt: null, startedAt: at(14, 58) }));
    expect(steps[1]).toEqual({
      key: "enroute", label: "On the way", state: "skipped", time: null, jumpTo: null,
    });
    // …and On site is simply where the visit now is.
    expect(steps[2]?.state).toBe("current");
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

/**
 * THE FOURTH NODE.
 *
 * The stepper stopped at "On site", so a finished visit that skipped the middle two rendered
 * exactly like a scheduled one — Scheduled stamped, both others "skipped" — and the ONLY thing
 * on the sheet saying it had finished was the office's ↩ Reopen button. Owen read that, correctly,
 * as a contradiction: reopen what?
 *
 * Finishing is a recorded event with a real stamp (completedAt, written by set-visit-status.ts),
 * so it belongs on the line with the other three.
 */
describe("visitSteps — the Done node", () => {
  it("a finished visit reads Done, with the stamp it was finished at", () => {
    const steps = visitSteps(visit({ status: "done", completedAt: at(13, 47) }));
    const done = steps[steps.length - 1]!;
    expect(done.key).toBe("done");
    expect(done.label).toBe("Done");
    expect(done.state).toBe("reached");
    expect(done.time).toBe("1:47p");
  });

  it("an unfinished visit shows Done as pending, and it IS tappable from anywhere ahead", () => {
    for (const status of ["scheduled", "enroute", "onsite"] as const) {
      const done = visitSteps(visit({ status }))[3]!;
      expect(done.state).toBe("pending");
      // Three dots responding and a fourth that does not reads as broken, not as restraint.
      // The foot keeps its primary; this is the same move by the other hand.
      expect(done.jumpTo).toBe("done");
    }
  });

  it("is never SKIPPED — a visit is finished or it is not, and that is known from the record", () => {
    // No completedAt (a legacy row, or a job completed by a path that left it null). It still
    // finished; "skipped" would say nobody finished it, which is a different and false claim.
    const done = visitSteps(visit({ status: "done" }))[3]!;
    expect(done.state).toBe("reached");
    expect(done.time).toBeNull();
  });

  it("leaves the first three nodes exactly as they were", () => {
    const steps = visitSteps(visit({ status: "done", completedAt: at(13, 47) }));
    expect(steps.map((s) => s.key)).toEqual(["scheduled", "enroute", "onsite", "done"]);
    expect(steps[1]!.state).toBe("skipped");
    expect(steps[2]!.state).toBe("skipped");
  });
});
