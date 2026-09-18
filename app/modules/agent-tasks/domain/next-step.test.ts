import { describe, it, expect } from "vitest";
import { clampNextStep } from "./next-step";
import { MAX_STEP_DAYS, MIN_STEP_MINUTES } from "../app/agent-task-config";

const NOW = new Date("2026-08-20T17:00:00Z");
const plus = (ms: number) => new Date(NOW.getTime() + ms);
const MIN_MS = MIN_STEP_MINUTES * 60_000;

describe("clampNextStep", () => {
  it("passes a sensible request through untouched", () => {
    const at = plus(2 * 60 * 60_000);
    expect(clampNextStep(at, NOW)).toEqual({ at, clamped: null });
  });

  it("pushes a too-soon request out to the floor", () => {
    const r = clampNextStep(plus(30_000), NOW);
    expect(r.clamped).toBe("min");
    expect(r.at.getTime()).toBe(NOW.getTime() + MIN_MS);
  });

  it("treats a request in the past as too soon rather than as an error", () => {
    const r = clampNextStep(plus(-86_400_000), NOW);
    expect(r.clamped).toBe("min");
    expect(r.at.getTime()).toBe(NOW.getTime() + MIN_MS);
  });

  it("pulls a too-distant request back to the horizon", () => {
    const r = clampNextStep(plus(400 * 86_400_000), NOW);
    expect(r.clamped).toBe("max");
    expect(r.at.getTime()).toBe(NOW.getTime() + MAX_STEP_DAYS * 86_400_000);
  });

  it("clamps an unparseable date to the floor instead of throwing", () => {
    const r = clampNextStep(new Date("nonsense"), NOW);
    expect(r.clamped).toBe("min");
    expect(Number.isNaN(r.at.getTime())).toBe(false);
  });
});
