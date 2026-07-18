import { describe, it, expect } from "vitest";
import { shouldShowFirstRun } from "./customers-utils";

// The first-run empty state must appear ONLY on a successful, empty load — never while loading
// (no flash) and never on error (a failed load is not "no customers").
describe("shouldShowFirstRun", () => {
  it("is false while the list is still loading (not yet fetched) — prevents a flash", () => {
    expect(shouldShowFirstRun({ isFetched: false, isError: false, count: 0 })).toBe(false);
  });

  it("is false when the load errored — a failed load is not 'no customers'", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: true, count: 0 })).toBe(false);
  });

  it("is true only when the load succeeded and there are zero customers", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 0 })).toBe(true);
  });

  it("is false once at least one customer exists (active or archived)", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 1 })).toBe(false);
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 42 })).toBe(false);
  });
});
