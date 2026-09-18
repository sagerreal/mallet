import { describe, it, expect } from "vitest";
import { shouldShowFirstRun, isFirstLoad } from "./first-run";

// The first-run empty state must appear ONLY on a successful, empty load — never while loading
// (no flash) and never on error (a failed load is not "no rows").
describe("shouldShowFirstRun", () => {
  it("is false while the list is still loading (not yet fetched) — prevents a flash", () => {
    expect(shouldShowFirstRun({ isFetched: false, isError: false, count: 0 })).toBe(false);
  });

  it("is false when the load errored — a failed load is not 'no rows'", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: true, count: 0 })).toBe(false);
  });

  it("is true only when the load succeeded and there are zero rows", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 0 })).toBe(true);
  });

  it("is false once at least one row exists (active or archived)", () => {
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 1 })).toBe(false);
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 42 })).toBe(false);
  });
});

// isFirstLoad marks the cold-load window (query in flight, store still empty) so pages can render a
// loading affordance instead of flashing "nothing here". It and shouldShowFirstRun are mutually
// exclusive: a list is never both first-loading and showing the first-run screen.
describe("isFirstLoad", () => {
  it("is true only while the first load is in flight and the store is empty", () => {
    expect(isFirstLoad({ isFetched: false, isError: false, count: 0 })).toBe(true);
  });

  it("is false once the load has completed, even if empty (that is first-run, not loading)", () => {
    expect(isFirstLoad({ isFetched: true, isError: false, count: 0 })).toBe(false);
    expect(shouldShowFirstRun({ isFetched: true, isError: false, count: 0 })).toBe(true);
  });

  it("is false when the load errored — don't spin forever on a failed load", () => {
    expect(isFirstLoad({ isFetched: false, isError: true, count: 0 })).toBe(false);
  });

  it("is false when rows are already present (e.g. cached), even mid-refetch", () => {
    expect(isFirstLoad({ isFetched: false, isError: false, count: 3 })).toBe(false);
  });
});
