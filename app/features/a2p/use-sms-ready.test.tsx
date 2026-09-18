// @vitest-environment jsdom
/**
 * features/a2p/use-sms-ready.test.tsx
 * The gate FAILS CLOSED. A Send that the carrier is certain to refuse is worse than one that is
 * honestly blocked, and the window where the hydrator hasn't landed yet is exactly when a board
 * full of live-looking Send buttons would be drawn.
 *
 * FOUR "NO"S, NOT ONE. The gate used to answer every non-active state with the same sentence —
 * "finish A2P registration in Settings" — which is wrong for the three pending states (the shop
 * already finished; a carrier is reviewing) and wrong before the hydrator lands (nobody knows
 * yet). Each state names whose move it is, or names nobody's.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { A2pStatusView } from "@mallet/a2p";
import { useSmsGate, useSmsReady } from "./use-sms-ready";
import {
  SMS_CHECKING_NOTE,
  SMS_FAILED_NOTE,
  SMS_FIX_LABEL,
  SMS_NOT_SET_UP_NOTE,
  SMS_PENDING_DETAIL,
  SMS_PENDING_NOTE,
  SMS_SETTINGS_HREF,
  SMS_SETUP_LABEL,
} from "./sms-copy";

const state = { a2pStatus: null as A2pStatusView | null };

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: typeof state) => unknown) => sel(state),
}));

const view = (over: Partial<A2pStatusView>): A2pStatusView => ({
  status: "brand_pending", canText: false, needsInput: false, failureReason: null, ...over,
});

const gate = () => renderHook(() => useSmsGate()).result.current;

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

describe("useSmsGate — checking", () => {
  it("states the wait and offers nothing to press", () => {
    state.a2pStatus = null;
    const g = gate();
    expect(g).toMatchObject({ ready: false, state: "checking", note: SMS_CHECKING_NOTE, action: null });
  });

  it("carries no banner text, so nothing is claimed before the answer arrives", () => {
    state.a2pStatus = null;
    expect(gate().detail).toBeNull();
  });

  it("never blames the shop while it is still loading", () => {
    state.a2pStatus = null;
    expect(gate().note).not.toBe(SMS_NOT_SET_UP_NOTE);
  });

  it("treats a missing key the same as an unlanded hydrator, rather than throwing", () => {
    // A surface mounted outside the office shell has no A2pHydrator above it, so the key can be
    // absent rather than null. Both mean the same thing — we do not know — and both fail closed.
    state.a2pStatus = undefined as unknown as A2pStatusView | null;
    expect(gate()).toMatchObject({ ready: false, state: "checking" });
  });
});

describe("useSmsGate — not started", () => {
  it("names the task and points at the Texting card itself", () => {
    state.a2pStatus = view({ status: "not_started", needsInput: true });
    expect(gate()).toMatchObject({
      ready: false,
      state: "not_started",
      note: SMS_NOT_SET_UP_NOTE,
      action: { label: SMS_SETUP_LABEL, href: SMS_SETTINGS_HREF },
    });
  });
});

/**
 * The state the old single message got flatly wrong. All five in-flight statuses mean the same
 * thing to a shop — somebody else is reviewing it — so they collapse to one answer with no action.
 */
describe("useSmsGate — being approved", () => {
  it.each(["collecting", "profile_pending", "brand_pending", "campaign_pending", "number_pending"] as const)(
    "reads %s as waiting on the carrier, not as unfinished setup",
    (status) => {
      state.a2pStatus = view({ status });
      expect(gate()).toMatchObject({ ready: false, state: "pending", note: SMS_PENDING_NOTE });
    },
  );

  it("offers NO action — there is no step for anyone to take", () => {
    state.a2pStatus = view({ status: "campaign_pending" });
    expect(gate().action).toBeNull();
  });

  it("tells the shop how long, and that it lands by itself", () => {
    state.a2pStatus = view({ status: "brand_pending" });
    expect(gate().detail).toBe(SMS_PENDING_DETAIL);
  });

  it("does not tell a shop that already registered to go and register", () => {
    state.a2pStatus = view({ status: "brand_pending" });
    expect(gate().note).not.toBe(SMS_NOT_SET_UP_NOTE);
  });
});

describe("useSmsGate — rejected", () => {
  it("shows the carrier's own words, not ours", () => {
    state.a2pStatus = view({ status: "failed", needsInput: true, failureReason: "EIN did not match" });
    expect(gate()).toMatchObject({
      ready: false,
      state: "failed",
      note: SMS_FAILED_NOTE,
      detail: "EIN did not match",
      action: { label: SMS_FIX_LABEL, href: SMS_SETTINGS_HREF },
    });
  });

  it("still says something useful when the carrier gave no reason", () => {
    state.a2pStatus = view({ status: "failed", needsInput: true, failureReason: null });
    expect(gate().detail).toBeTruthy();
    expect(gate().action).not.toBeNull();
  });
});

describe("useSmsGate — active", () => {
  it("has nothing to say at all", () => {
    state.a2pStatus = view({ status: "active", canText: true });
    expect(gate()).toEqual({ ready: true, state: "active", note: null, detail: null, action: null });
  });
});
