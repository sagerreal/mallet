// @vitest-environment jsdom
/**
 * features/a2p/use-sms-ready.test.tsx
 * The gate FAILS CLOSED. A Send that the carrier is certain to refuse is worse than one that is
 * honestly disabled, and the window where the hydrator hasn't landed yet is exactly when a board
 * full of live-looking Send buttons would be drawn.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { A2pStatusView } from "@mallet/a2p";
import { SMS_CHECKING_REASON, SMS_NOT_READY_REASON, useSmsGate, useSmsReady } from "./use-sms-ready";

const state = { a2pStatus: null as A2pStatusView | null };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

const view = (over: Partial<A2pStatusView>): A2pStatusView => ({
  status: "brand_pending", canText: false, needsInput: false, failureReason: null, ...over,
});

describe("useSmsReady", () => {
  it("is false before the hydrator has landed", () => {
    state.a2pStatus = null;
    expect(renderHook(() => useSmsReady()).result.current).toBe(false);
  });

  it("is false while registration is still in flight", () => {
    state.a2pStatus = view({ status: "brand_pending" });
    expect(renderHook(() => useSmsReady()).result.current).toBe(false);
  });

  it("is false when registration failed, whatever the reason", () => {
    state.a2pStatus = view({ status: "failed", failureReason: "brand rejected" });
    expect(renderHook(() => useSmsReady()).result.current).toBe(false);
  });

  it("is true only once the campaign is active", () => {
    state.a2pStatus = view({ status: "active", canText: true });
    expect(renderHook(() => useSmsReady()).result.current).toBe(true);
  });
});

/**
 * The two "no"s are not the same sentence. Telling a fully registered shop that its texting
 * "isn't set up yet" for the length of a fetch sends the owner to Settings to fix nothing —
 * the hydration-flash law applied to a claim rather than a number.
 */
describe("useSmsGate — why Send is blocked", () => {
  it("says it is still checking before the hydrator lands", () => {
    state.a2pStatus = null;
    expect(renderHook(() => useSmsGate()).result.current).toEqual({
      ready: false,
      reason: SMS_CHECKING_REASON,
    });
  });

  it("names the unfinished registration once the answer is in", () => {
    state.a2pStatus = view({ status: "brand_pending" });
    expect(renderHook(() => useSmsGate()).result.current).toEqual({
      ready: false,
      reason: SMS_NOT_READY_REASON,
    });
  });

  it("has no reason to give when texting works", () => {
    state.a2pStatus = view({ status: "active", canText: true });
    expect(renderHook(() => useSmsGate()).result.current).toEqual({ ready: true, reason: null });
  });

  it("never blames the shop while it is still loading", () => {
    state.a2pStatus = null;
    expect(renderHook(() => useSmsGate()).result.current.reason).not.toBe(SMS_NOT_READY_REASON);
  });
});
