// @vitest-environment jsdom
/**
 * features/settings/use-org-service-fee.test.ts
 * The field shell never mounts SettingsHydrator, so this hook is the only correct source
 * for the org's real visit fee on that surface. Guards: fetches only when enabled, resolves
 * the fee from the settings DTO, and stays null (never fabricates a number) on disable or
 * fetch failure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const queryMock = vi.fn();
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { settings: { get: { query: (...a: unknown[]) => queryMock(...a) } } } },
}));

import { useOrgServiceFee } from "./use-org-service-fee";

describe("useOrgServiceFee", () => {
  beforeEach(() => queryMock.mockReset());

  it("stays null and never fetches while disabled", () => {
    const { result } = renderHook(() => useOrgServiceFee(false));
    expect(result.current).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("resolves the org's configured fee once enabled", async () => {
    queryMock.mockResolvedValue({ config: { booking: { serviceFee: 129 } } });
    const { result } = renderHook(() => useOrgServiceFee(true));
    await waitFor(() => expect(result.current).toBe(129));
  });

  it("stays null when the fetch fails — never a fabricated fee", async () => {
    // mockRejectedValueOnce (not the persistent mockRejectedValue) — a vitest/tinyspy quirk
    // flags a persistent rejecting implementation set right after mockReset() as a phantom
    // unhandled rejection even though the hook's own .catch() genuinely handles it.
    queryMock.mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() => useOrgServiceFee(true));
    await waitFor(() => expect(queryMock).toHaveBeenCalled());
    // Give the rejected promise's .catch a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
