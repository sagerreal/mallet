import { describe, it, expect } from "vitest";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "./first-run";

describe("shouldShowLoadFailed", () => {
  it("fires when the query errored and nothing is cached", () => {
    expect(shouldShowLoadFailed({ isFetched: true, isError: true, count: 0 })).toBe(true);
  });

  it("does NOT fire when rows are cached — stale data beats an error screen", () => {
    expect(shouldShowLoadFailed({ isFetched: true, isError: true, count: 12 })).toBe(false);
  });

  it("does NOT fire on a successful empty load — that's first-run", () => {
    expect(shouldShowLoadFailed({ isFetched: true, isError: false, count: 0 })).toBe(false);
  });

  it("is mutually exclusive with the other two states", () => {
    const cases = [
      { isFetched: false, isError: false, count: 0 }, // cold load
      { isFetched: true, isError: false, count: 0 },  // genuinely empty
      { isFetched: true, isError: true, count: 0 },   // failed
      { isFetched: true, isError: false, count: 5 },  // populated
    ];
    for (const c of cases) {
      const on = [shouldShowFirstRun(c), isFirstLoad(c), shouldShowLoadFailed(c)].filter(Boolean);
      expect(on.length, `${JSON.stringify(c)} lit ${on.length} states`).toBeLessThanOrEqual(1);
    }
  });
});
