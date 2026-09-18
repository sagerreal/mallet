// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { StrictMode } from "react";
import { renderHook, act } from "@testing-library/react";

// The state hook is pure React state, but the module it lives in imports the tRPC client at the
// top level. Stubbing it keeps this a state test rather than a network one.
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { customers: { list: { useInfiniteQuery: () => ({}) }, count: { useQuery: () => ({}) }, groupCounts: { useQuery: () => ({}) } } } },
}));

import { useCustomersQueryState } from "./use-customers-query";

/**
 * The Name column's sort direction.
 *
 * `sortDir: null` is what the screen renders as ASCENDING (customers-view maps only "desc" to the
 * ▼ arrow), so the first flip away from a freshly-picked column has to land on "desc". It used to
 * call setSortDir from INSIDE the setSortCol updater, and React invokes an updater twice in dev —
 * so the second click on Name toggled twice and stuck on descending forever, while in production
 * it went null → "asc" and nothing on screen changed at all.
 */
describe("useCustomersQueryState — column sort toggle", () => {
  it("picks the column on the first click and leaves the direction on its default", () => {
    const { result } = renderHook(() => useCustomersQueryState());
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortCol).toBe("name");
    expect(result.current.sortDir).toBeNull();
  });

  it("flips to descending on the second click and back to ascending on the third", () => {
    const { result } = renderHook(() => useCustomersQueryState());
    act(() => result.current.toggleSortCol("name"));
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("flips once per click under StrictMode's double-invoked updaters", () => {
    const { result } = renderHook(() => useCustomersQueryState(), { wrapper: StrictMode });
    act(() => result.current.toggleSortCol("name"));
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("resets to the new column's default direction when a different column is clicked", () => {
    const { result } = renderHook(() => useCustomersQueryState());
    act(() => result.current.toggleSortCol("name"));
    act(() => result.current.toggleSortCol("name"));
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.toggleSortCol("age"));
    expect(result.current.sortCol).toBe("age");
    expect(result.current.sortDir).toBeNull();
  });
});
