// @vitest-environment jsdom
/**
 * The Text button's gate. Its whole reason to exist is that "may this shop text" was being asked
 * as "is this person the office" — a different question with a different answer.
 *
 * Two contracts, and they are not the same contract:
 *   - it FAILS CLOSED on a read that did not answer — nothing short of a real `true` draws a
 *     button the carrier is certain to refuse;
 *   - it takes the SERVER SEED before the client query lands, so the sheet does not paint Call
 *     alone and then grow a Text button a beat later. Fail-closed used to cover both, which is
 *     how the absent→present flash got bought with the present→absent one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { CanTextProvider, useCanText } from "./use-can-text";
import type { CanTextSeed } from "@/lib/field-toggles-seed";

const fieldTogglesQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { settings: { fieldToggles: { useQuery: () => fieldTogglesQuery() } } } },
}));

const seeded = (seed: CanTextSeed) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <CanTextProvider seed={seed}>{children}</CanTextProvider>;
  };

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

  // With no provider in the tree the seed defaults to "unknown", so the original fail-closed
  // behaviour is exactly what remains: a read that did not answer is not permission.
  it.each([
    ["still loading", { data: undefined }],
    ["a failed read", { data: undefined, isError: true }],
  ])("is false while %s and nothing was seeded", (_label, queryResult) => {
    fieldTogglesQuery.mockReturnValue(queryResult);
    expect(renderHook(() => useCanText()).result.current).toBe(false);
  });
});

// THE FLASH. The layout resolves this org's fieldToggles per request and passes it down, so the
// first paint already knows. Without the seed every one of these is false-then-true.
describe("useCanText — the server seed covers first paint", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true from the very first render when the server seeded yes", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined }); // cache empty, as at mount
    const { result } = renderHook(() => useCanText(), { wrapper: seeded("yes") });
    expect(result.current).toBe(true);
  });

  it("is false from the very first render when the server seeded no", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useCanText(), { wrapper: seeded("no") });
    expect(result.current).toBe(false);
  });

  it("still fails closed when the server's own read failed", () => {
    fieldTogglesQuery.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useCanText(), { wrapper: seeded("unknown") });
    expect(result.current).toBe(false);
  });

  // The live read is the fresher answer: a campaign approved mid-session must show up without a
  // reload, and one revoked must stop drawing the button.
  it("the landed query outranks the seed, both ways", () => {
    fieldTogglesQuery.mockReturnValue({ data: { measurementEstimating: false, canText: true } });
    expect(renderHook(() => useCanText(), { wrapper: seeded("no") }).result.current).toBe(true);

    fieldTogglesQuery.mockReturnValue({ data: { measurementEstimating: false, canText: false } });
    expect(renderHook(() => useCanText(), { wrapper: seeded("yes") }).result.current).toBe(false);
  });
});
