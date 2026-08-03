import { describe, it, expect } from "vitest";
import { inboxQueryOptions, INBOX_POLL_MS } from "./inbox-query-options";

/**
 * The inbox used to run staleTime 5s under a 15s poll — nearly every Messages tab click found
 * "stale" data and fired a fetch the interval was about to make anyway. These pin the repaired
 * relationship: one constant drives both, so a tab click inside the poll window hits the cache.
 */
describe("inboxQueryOptions", () => {
  it("keeps polling — messages have no realtime channel", () => {
    expect(inboxQueryOptions.refetchInterval).toBe(INBOX_POLL_MS);
  });

  it("a tab click inside the poll window is served from cache (staleTime covers the interval)", () => {
    expect(inboxQueryOptions.staleTime).toBeGreaterThanOrEqual(inboxQueryOptions.refetchInterval);
  });

  it("still refetches on focus — returning to the app is when a customer text is waiting", () => {
    expect(inboxQueryOptions.refetchOnWindowFocus).toBe(true);
  });
});
