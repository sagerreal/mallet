// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const nativePlugin = vi.fn();
const isNativeShell = vi.fn();

vi.mock("@/lib/native-bridge", () => ({
  nativePlugin: (...a: unknown[]) => nativePlugin(...a),
  isNativeShell: () => isNativeShell(),
}));

// Import after the mock so the module under test picks up the mocked native bridge.
import {
  tapToPayPlugin,
  tapToPayAvailability,
  useTapToPayAvailability,
  resetTapToPayAvailabilityCache,
  TAP_TO_PAY_PROBE_TIMEOUT_MS,
} from "./tap-to-pay";

/** Most cases below run "inside the shell" — the browser case is its own test. */
function inShell(plugin: unknown): void {
  isNativeShell.mockReturnValue(true);
  nativePlugin.mockReturnValue(plugin);
}

describe("tapToPayPlugin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("looks up the plugin by ITS name and returns null when absent", () => {
    nativePlugin.mockReturnValue(null);
    expect(tapToPayPlugin()).toBeNull();
    expect(nativePlugin).toHaveBeenCalledWith("MalletTapToPay");
  });
});

describe("tapToPayAvailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is no-native-app in a browser — no Capacitor bridge at all", async () => {
    isNativeShell.mockReturnValue(false);
    await expect(tapToPayAvailability()).resolves.toEqual({ status: "no-native-app" });
    expect(nativePlugin).not.toHaveBeenCalled();
  });

  it("is plugin-missing inside the shell while the plugin does not exist yet — the PR1 state", async () => {
    inShell(null);
    await expect(tapToPayAvailability()).resolves.toEqual({ status: "plugin-missing" });
  });

  it("is ready when a future plugin answers supported: true", async () => {
    inShell({ available: async () => ({ available: true }) });
    await expect(tapToPayAvailability()).resolves.toEqual({ status: "ready" });
  });

  it("is unsupported-device when the plugin answers supported: false", async () => {
    inShell({ available: async () => ({ available: false, reason: "iphone-too-old" }) });
    await expect(tapToPayAvailability()).resolves.toEqual({ status: "unsupported-device" });
  });

  it("treats a rejecting probe as plugin-missing — a probe that fails is not a yes", async () => {
    inShell({
      available: async () => {
        throw new Error("bridge fault");
      },
    });
    await expect(tapToPayAvailability()).resolves.toEqual({ status: "plugin-missing" });
  });

  it("bounds a probe that never settles instead of reporting `checking` forever", async () => {
    vi.useFakeTimers();
    try {
      inShell({ available: () => new Promise(() => {}) });
      const probe = tapToPayAvailability();
      await vi.advanceTimersByTimeAsync(TAP_TO_PAY_PROBE_TIMEOUT_MS + 1);
      await expect(probe).resolves.toEqual({ status: "plugin-missing" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useTapToPayAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTapToPayAvailabilityCache();
  });

  it("starts at checking (SSR-safe) and lands on the probe's answer", async () => {
    isNativeShell.mockReturnValue(false);
    const { result } = renderHook(() => useTapToPayAvailability());
    expect(result.current.status).toBe("checking");
    await waitFor(() => expect(result.current.status).toBe("no-native-app"));
  });

  it("shares one probe across mounts once a settled answer is cached", async () => {
    inShell(null);
    const first = renderHook(() => useTapToPayAvailability());
    await waitFor(() => expect(first.result.current.status).toBe("plugin-missing"));
    first.unmount();
    // plugin-missing is retried up to the budget, then cached; drain the budget.
    const second = renderHook(() => useTapToPayAvailability());
    await waitFor(() => expect(second.result.current.status).toBe("plugin-missing"));
    second.unmount();
    const third = renderHook(() => useTapToPayAvailability());
    await waitFor(() => expect(third.result.current.status).toBe("plugin-missing"));
    const callsAfterCache = isNativeShell.mock.calls.length;
    const fourth = renderHook(() => useTapToPayAvailability());
    await waitFor(() => expect(fourth.result.current.status).toBe("plugin-missing"));
    expect(isNativeShell.mock.calls.length).toBe(callsAfterCache);
  });
});
