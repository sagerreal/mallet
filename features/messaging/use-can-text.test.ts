// @vitest-environment jsdom
/**
 * The Text button's gate. Its whole reason to exist is that "may this shop text" was being asked
 * as "is this person the office" — a different question with a different answer. The contract
 * that matters is that it FAILS CLOSED: anything short of an explicit `true` draws no button.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanText } from "./use-can-text";

const fieldTogglesQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { fieldToggles: { useQuery: () => fieldTogglesQuery() } } } },
}));

describe("useCanText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true only when the org's campaign is active", () => {
    fieldTogglesQuery.mockReturnValue({ data: { measurementEstimating: false, canText: true } });
    expect(renderHook(() => useCanText()).result.current).toBe(true);
  });

  it("is false when the org cannot text", () => {
    fieldTogglesQuery.mockReturnValue({ data: { measurementEstimating: true, canText: false } });
    expect(renderHook(() => useCanText()).result.current).toBe(false);
  });

  // Fails closed on both: a Text button that flashes in and then vanishes is worse than one that
  // never appeared, and a read that did not answer is not permission.
  it.each([
    ["still loading", { data: undefined }],
    ["a failed read", { data: undefined, isError: true }],
  ])("is false while %s", (_label, queryResult) => {
    fieldTogglesQuery.mockReturnValue(queryResult);
    expect(renderHook(() => useCanText()).result.current).toBe(false);
  });
});
