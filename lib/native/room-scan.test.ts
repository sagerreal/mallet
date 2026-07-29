// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const nativePlugin = vi.fn();

vi.mock("@/lib/native-bridge", () => ({
  nativePlugin: (...a: unknown[]) => nativePlugin(...a),
}));

// Import after the mock so the module under test picks up the mocked nativePlugin.
import {
  roomScanPlugin,
  roomScanAvailable,
  captureRoom,
  RoomScanPayloadError,
  RoomScanCaptureError,
  useRoomScanAvailable,
  resetRoomScanAvailableCache,
} from "./room-scan";

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

describe("roomScanAvailable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is false when the plugin is absent", async () => {
    nativePlugin.mockReturnValue(null);
    await expect(roomScanAvailable()).resolves.toBe(false);
  });

  it("is true when the plugin reports available", async () => {
    nativePlugin.mockReturnValue({ available: vi.fn().mockResolvedValue({ available: true }) });
    await expect(roomScanAvailable()).resolves.toBe(true);
  });

  it("is false when the plugin reports unavailable (e.g. no LiDAR)", async () => {
    nativePlugin.mockReturnValue({
      available: vi.fn().mockResolvedValue({ available: false, reason: "no_lidar" }),
    });
    await expect(roomScanAvailable()).resolves.toBe(false);
  });

  it("is false when the availability check itself throws", async () => {
    nativePlugin.mockReturnValue({ available: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(roomScanAvailable()).resolves.toBe(false);
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

describe("useRoomScanAvailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRoomScanAvailableCache();
  });

  it("starts false and resolves true once the plugin reports available", async () => {
    nativePlugin.mockReturnValue({ available: vi.fn().mockResolvedValue({ available: true }) });

    const { result } = renderHook(() => useRoomScanAvailable());
    expect(result.current).toBe(false);

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("resolves false when the plugin is absent", async () => {
    nativePlugin.mockReturnValue(null);

    const { result } = renderHook(() => useRoomScanAvailable());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("probes the plugin only once across multiple mounted hooks", async () => {
    const available = vi.fn().mockResolvedValue({ available: true });
    nativePlugin.mockReturnValue({ available });

    const first = renderHook(() => useRoomScanAvailable());
    const second = renderHook(() => useRoomScanAvailable());

    await waitFor(() => expect(first.result.current).toBe(true));
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(available).toHaveBeenCalledTimes(1);
  });
});
