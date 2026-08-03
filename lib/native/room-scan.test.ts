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
  roomScanPlugin,
  roomScanAvailability,
  captureRoom,
  RoomScanPayloadError,
  RoomScanCaptureError,
  useRoomScanAvailability,
  resetRoomScanAvailabilityCache,
} from "./room-scan";

/** Most cases below run "inside the shell" — the browser case is its own test. */
function inShell(plugin: unknown): void {
  isNativeShell.mockReturnValue(true);
  nativePlugin.mockReturnValue(plugin);
}

describe("roomScanPlugin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when the plugin is absent", () => {
    nativePlugin.mockReturnValue(null);
    expect(roomScanPlugin()).toBeNull();
    expect(nativePlugin).toHaveBeenCalledWith("MalletRoomScan");
  });

  it("returns the plugin when present", () => {
    const plugin = { captureRoom: vi.fn(), available: vi.fn() };
    nativePlugin.mockReturnValue(plugin);
    expect(roomScanPlugin()).toBe(plugin);
  });
});

describe("roomScanAvailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is no-native-app in a browser — no Capacitor bridge at all", async () => {
    isNativeShell.mockReturnValue(false);
    await expect(roomScanAvailability()).resolves.toEqual({ status: "no-native-app" });
  });

  it("does not even look for the plugin when there is no bridge", async () => {
    isNativeShell.mockReturnValue(false);
    await roomScanAvailability();
    expect(nativePlugin).not.toHaveBeenCalled();
  });

  it("is scanner-missing when the bridge is there but the plugin is not registered", async () => {
    inShell(null);
    await expect(roomScanAvailability()).resolves.toEqual({ status: "scanner-missing" });
  });

  it("is ready when the plugin reports available", async () => {
    inShell({ available: vi.fn().mockResolvedValue({ available: true }) });
    await expect(roomScanAvailability()).resolves.toEqual({ status: "ready" });
  });

  it("is no-lidar when the plugin reports the device cannot scan", async () => {
    inShell({ available: vi.fn().mockResolvedValue({ available: false, reason: "no_lidar" }) });
    await expect(roomScanAvailability()).resolves.toEqual({ status: "no-lidar" });
  });

  it("is scanner-missing when the availability probe itself rejects — a failed probe is not a yes", async () => {
    inShell({ available: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(roomScanAvailability()).resolves.toEqual({ status: "scanner-missing" });
  });

  it("distinguishes no-plugin from plugin-says-unsupported — the two must never collapse", async () => {
    inShell(null);
    const noPlugin = await roomScanAvailability();
    inShell({ available: vi.fn().mockResolvedValue({ available: false }) });
    const unsupported = await roomScanAvailability();

    expect(noPlugin.status).not.toBe(unsupported.status);
  });

  it("never returns checking — that is a hook-only state", async () => {
    isNativeShell.mockReturnValue(false);
    expect((await roomScanAvailability()).status).not.toBe("checking");
    inShell({ available: vi.fn().mockResolvedValue({ available: true }) });
    expect((await roomScanAvailability()).status).not.toBe("checking");
  });
});

describe("captureRoom", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws when the plugin is absent", async () => {
    nativePlugin.mockReturnValue(null);
    await expect(captureRoom("Kitchen")).rejects.toThrow(/not available/);
  });

  it("returns cancelled as-is", async () => {
    nativePlugin.mockReturnValue({ captureRoom: vi.fn().mockResolvedValue({ status: "cancelled" }) });
    await expect(captureRoom("Kitchen")).resolves.toEqual({ status: "cancelled" });
  });

  it("parses both JSON strings on done", async () => {
    nativePlugin.mockReturnValue({
      captureRoom: vi.fn().mockResolvedValue({
        status: "done",
        rawPayload: JSON.stringify({ raw: true }),
        geometry: JSON.stringify({ walls: [] }),
        capturedAt: "2026-07-29T00:00:00.000Z",
      }),
    });

    await expect(captureRoom("Kitchen")).resolves.toEqual({
      status: "done",
      rawPayload: { raw: true },
      geometry: { walls: [] },
      capturedAt: "2026-07-29T00:00:00.000Z",
    });
  });

  it("throws a named RoomScanPayloadError on invalid rawPayload JSON", async () => {
    nativePlugin.mockReturnValue({
      captureRoom: vi.fn().mockResolvedValue({
        status: "done",
        rawPayload: "{not json",
        geometry: JSON.stringify({ walls: [] }),
        capturedAt: "2026-07-29T00:00:00.000Z",
      }),
    });

    await expect(captureRoom("Kitchen")).rejects.toBeInstanceOf(RoomScanPayloadError);
  });

  it("throws a named RoomScanPayloadError on invalid geometry JSON", async () => {
    nativePlugin.mockReturnValue({
      captureRoom: vi.fn().mockResolvedValue({
        status: "done",
        rawPayload: JSON.stringify({ raw: true }),
        geometry: "{not json",
        capturedAt: "2026-07-29T00:00:00.000Z",
      }),
    });

    await expect(captureRoom("Kitchen")).rejects.toBeInstanceOf(RoomScanPayloadError);
  });

  it("passes the room name through to the plugin", async () => {
    const pluginCaptureRoom = vi.fn().mockResolvedValue({ status: "cancelled" });
    nativePlugin.mockReturnValue({ captureRoom: pluginCaptureRoom });

    await captureRoom("Primary Bedroom");

    expect(pluginCaptureRoom).toHaveBeenCalledWith({ roomName: "Primary Bedroom" });
  });

  it("wraps a native captureRoom rejection in a named RoomScanCaptureError carrying the native message verbatim", async () => {
    nativePlugin.mockReturnValue({
      captureRoom: vi
        .fn()
        .mockRejectedValue(new Error("The scan didn't capture a floor — walk the room's perimeter and scan again.")),
    });

    const rejection = captureRoom("Kitchen");
    await expect(rejection).rejects.toBeInstanceOf(RoomScanCaptureError);
    await expect(rejection).rejects.toThrow("The scan didn't capture a floor — walk the room's perimeter and scan again.");
  });

  it("does not wrap a post-resolve JSON parse failure in RoomScanCaptureError — that stays RoomScanPayloadError", async () => {
    nativePlugin.mockReturnValue({
      captureRoom: vi.fn().mockResolvedValue({
        status: "done",
        rawPayload: "{not json",
        geometry: JSON.stringify({ walls: [] }),
        capturedAt: "2026-07-29T00:00:00.000Z",
      }),
    });

    const rejection = captureRoom("Kitchen");
    await expect(rejection).rejects.toBeInstanceOf(RoomScanPayloadError);
    await expect(rejection).rejects.not.toBeInstanceOf(RoomScanCaptureError);
  });
});

describe("useRoomScanAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomScanAvailabilityCache();
  });

  it("starts at checking — never at a guess, so no user is told the wrong reason", async () => {
    inShell({ available: vi.fn().mockResolvedValue({ available: true }) });

    const { result } = renderHook(() => useRoomScanAvailability());
    expect(result.current).toEqual({ status: "checking" });

    await waitFor(() => expect(result.current).toEqual({ status: "ready" }));
  });

  it("resolves to no-lidar on a device the plugin says cannot scan", async () => {
    inShell({ available: vi.fn().mockResolvedValue({ available: false }) });

    const { result } = renderHook(() => useRoomScanAvailability());
    await waitFor(() => expect(result.current).toEqual({ status: "no-lidar" }));
  });

  it("resolves to no-native-app in a browser", async () => {
    isNativeShell.mockReturnValue(false);

    const { result } = renderHook(() => useRoomScanAvailability());
    await waitFor(() => expect(result.current).toEqual({ status: "no-native-app" }));
  });

  it("probes the plugin only once across multiple mounted hooks", async () => {
    const available = vi.fn().mockResolvedValue({ available: true });
    inShell({ available });

    const first = renderHook(() => useRoomScanAvailability());
    const second = renderHook(() => useRoomScanAvailability());

    await waitFor(() => expect(first.result.current).toEqual({ status: "ready" }));
    await waitFor(() => expect(second.result.current).toEqual({ status: "ready" }));
    expect(available).toHaveBeenCalledTimes(1);
  });
});
