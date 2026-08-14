import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createMeasurementsSlice, type MeasurementsSlice } from "./measurements-slice";
import type { RoomCard } from "../types";

const mutate = {
  createManualRoom: vi.fn(),
  overrideQuantity: vi.fn(),
  confirmQuantity: vi.fn(),
  renameRoom: vi.fn(),
  archiveRoom: vi.fn(),
  ingestScan: vi.fn(),
  rescan: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      measurements: {
        createManualRoom: { mutate: (...a: unknown[]) => mutate.createManualRoom(...a) },
        overrideQuantity: { mutate: (...a: unknown[]) => mutate.overrideQuantity(...a) },
        confirmQuantity: { mutate: (...a: unknown[]) => mutate.confirmQuantity(...a) },
        renameRoom: { mutate: (...a: unknown[]) => mutate.renameRoom(...a) },
        archiveRoom: { mutate: (...a: unknown[]) => mutate.archiveRoom(...a) },
        ingestScan: { mutate: (...a: unknown[]) => mutate.ingestScan(...a) },
        rescan: { mutate: (...a: unknown[]) => mutate.rescan(...a) },
      },
    },
  },
}));

const captureRoom = vi.fn();
vi.mock("@/lib/native/room-scan", () => ({
  captureRoom: (...a: unknown[]) => captureRoom(...a),
}));

const reportWriteError = vi.fn();
vi.mock("../write-error", () => ({
  reportWriteError: (...a: unknown[]) => reportWriteError(...a),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

const JOB = "job-1";

const room = (overrides: Partial<RoomCard> = {}): RoomCard => ({
  deductions: [],
  walls: [],
  netWallsSqft: null,
  id: "room-1",
  jobId: JOB,
  roomName: "Kitchen",
  source: "manual",
  capturedAt: "2026-07-01T00:00:00.000Z",
  quantities: [
    { kind: "walls_sqft", value: 100, derivedValue: null, status: "confirmed" },
  ],
  ...overrides,
});

describe("measurementsSlice", () => {
  let store: StoreApi<MeasurementsSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<MeasurementsSlice>((set, get, api) =>
      createMeasurementsSlice(set, get, api),
    );
  });

  it("starts empty", () => {
    expect(store.getState().roomsByJob).toEqual({});
  });

  describe("setJobRooms", () => {
    it("replaces the slice for that job only", () => {
      store.getState().setJobRooms(JOB, [room()]);
      store.getState().setJobRooms("job-2", [room({ id: "room-2", jobId: "job-2" })]);
      expect(store.getState().roomsByJob[JOB]).toHaveLength(1);
      expect(store.getState().roomsByJob["job-2"]).toHaveLength(1);

      // Replaces (not appends) on a second call for the same job.
      store.getState().setJobRooms(JOB, [room({ id: "room-3" })]);
      expect(store.getState().roomsByJob[JOB]).toHaveLength(1);
      expect(store.getState().roomsByJob[JOB]![0]!.id).toBe("room-3");
    });
  });

  describe("addManualRoom", () => {
    it("optimistically appends with a client UUID, then reconciles with the server DTO", async () => {
      mutate.createManualRoom.mockImplementation(async (input: { id: string; jobId: string }) => ({
        id: input.id,
        jobId: input.jobId,
        roomName: "Kitchen",
        source: "manual",
        capturedAt: "2026-07-01T00:00:00.000Z",
        quantities: [
          { kind: "walls_sqft", value: 100, derivedValue: null, status: "confirmed" },
          { kind: "ceiling_sqft", value: null, derivedValue: null, status: "needs_confirm" },
        ],
      }));

      const { room: created, persisted } = store.getState().addManualRoom(JOB, "Kitchen", [
        { kind: "walls_sqft", value: 100 },
      ]);

      // Optimistic: appears immediately with the client-minted id.
      expect(store.getState().roomsByJob[JOB]).toHaveLength(1);
      expect(store.getState().roomsByJob[JOB]![0]!.id).toBe(created.id);
      expect(created.id).toMatch(/[0-9a-f-]{36}/);

      const reconciled = await persisted;

      // persisted resolves with the reconciled (server-canonical) room.
      expect(reconciled.id).toBe(created.id);
      expect(reconciled.quantities).toHaveLength(2);

      // Store adopts the same reconciled room.
      const stored = store.getState().roomsByJob[JOB]![0]!;
      expect(stored.id).toBe(created.id);
      expect(stored.quantities).toHaveLength(2);
    });

    it("rolls back the optimistic room AND rejects persisted on failure", async () => {
      mutate.createManualRoom.mockRejectedValue(new Error("boom"));
      const { room: created, persisted } = store.getState().addManualRoom(JOB, "Kitchen", [
        { kind: "walls_sqft", value: 100 },
      ]);
      expect(store.getState().roomsByJob[JOB]).toHaveLength(1);

      await expect(persisted).rejects.toThrow("boom");
      await flush();

      expect(store.getState().roomsByJob[JOB]!.some((r) => r.id === created.id)).toBe(false);
    });
  });

  describe("overrideQuantity", () => {
    beforeEach(() => {
      store.getState().setJobRooms(JOB, [room()]);
    });

    it("optimistically updates value+status, then reconciles from the returned quantity", async () => {
      mutate.overrideQuantity.mockResolvedValue({
        kind: "walls_sqft",
        value: 150,
        derivedValue: 140,
        status: "override",
      });

      store.getState().overrideQuantity(JOB, "room-1", "walls_sqft", 150);

      const optimistic = store.getState().roomsByJob[JOB]![0]!.quantities[0]!;
      expect(optimistic.value).toBe(150);
      expect(optimistic.status).toBe("override");

      await flush();

      const reconciled = store.getState().roomsByJob[JOB]![0]!.quantities[0]!;
      expect(reconciled.value).toBe(150);
      expect(reconciled.derivedValue).toBe(140);
    });

    it("rolls back to the pre-mutation snapshot on rejection", async () => {
      mutate.overrideQuantity.mockRejectedValue(new Error("boom"));

      store.getState().overrideQuantity(JOB, "room-1", "walls_sqft", 999);
      expect(store.getState().roomsByJob[JOB]![0]!.quantities[0]!.value).toBe(999);

      await flush();

      const restored = store.getState().roomsByJob[JOB]![0]!.quantities[0]!;
      expect(restored.value).toBe(100);
      expect(restored.status).toBe("confirmed");
    });
  });

  describe("confirmQuantity", () => {
    beforeEach(() => {
      store.getState().setJobRooms(JOB, [
        room({
          quantities: [
            { kind: "walls_sqft", value: null, derivedValue: 95, status: "needs_confirm" },
          ],
        }),
      ]);
    });

    it("optimistically confirms, then reconciles", async () => {
      mutate.confirmQuantity.mockResolvedValue({
        kind: "walls_sqft",
        value: 95,
        derivedValue: 95,
        status: "confirmed",
      });

      store.getState().confirmQuantity(JOB, "room-1", "walls_sqft", 95);
      expect(store.getState().roomsByJob[JOB]![0]!.quantities[0]!.status).toBe("confirmed");

      await flush();
      expect(store.getState().roomsByJob[JOB]![0]!.quantities[0]!.value).toBe(95);
    });
  });

  describe("setRoomQuantity — routes by current status", () => {
    it("calls confirmQuantity when the quantity is needs_confirm", () => {
      store.getState().setJobRooms(JOB, [
        room({
          quantities: [
            { kind: "walls_sqft", value: null, derivedValue: 95, status: "needs_confirm" },
          ],
        }),
      ]);
      mutate.confirmQuantity.mockResolvedValue({
        kind: "walls_sqft",
        value: 95,
        derivedValue: 95,
        status: "confirmed",
      });

      store.getState().setRoomQuantity(JOB, "room-1", "walls_sqft", 95);

      expect(mutate.confirmQuantity).toHaveBeenCalledWith({
        captureId: "room-1",
        kind: "walls_sqft",
        value: 95,
      });
      expect(mutate.overrideQuantity).not.toHaveBeenCalled();
    });

    it("calls overrideQuantity for any other current status", () => {
      store.getState().setJobRooms(JOB, [room()]); // status: confirmed
      mutate.overrideQuantity.mockResolvedValue({
        kind: "walls_sqft",
        value: 150,
        derivedValue: null,
        status: "override",
      });

      store.getState().setRoomQuantity(JOB, "room-1", "walls_sqft", 150);

      expect(mutate.overrideQuantity).toHaveBeenCalledWith({
        captureId: "room-1",
        kind: "walls_sqft",
        value: 150,
      });
      expect(mutate.confirmQuantity).not.toHaveBeenCalled();
    });
  });

  describe("renameRoom", () => {
    beforeEach(() => {
      store.getState().setJobRooms(JOB, [room()]);
    });

    it("optimistically renames, then reconciles from the server response", async () => {
      mutate.renameRoom.mockResolvedValue({ captureId: "room-1", roomName: "Primary Bedroom" });

      store.getState().renameRoom(JOB, "room-1", "  Primary Bedroom  ");
      expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Primary Bedroom");

      await flush();
      expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Primary Bedroom");
    });

    it("rolls back on failure", async () => {
      mutate.renameRoom.mockRejectedValue(new Error("boom"));

      store.getState().renameRoom(JOB, "room-1", "Primary Bedroom");
      expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Primary Bedroom");

      await flush();
      expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Kitchen");
    });
  });

  describe("archiveRoom", () => {
    beforeEach(() => {
      store.getState().setJobRooms(JOB, [room(), room({ id: "room-2", roomName: "Bath" })]);
    });

    it("optimistically removes the room", () => {
      mutate.archiveRoom.mockResolvedValue({ ok: true });
      store.getState().archiveRoom(JOB, "room-1");
      expect(store.getState().roomsByJob[JOB]!.map((r) => r.id)).toEqual(["room-2"]);
    });

    it("rolls back (re-inserts) on failure", async () => {
      mutate.archiveRoom.mockRejectedValue(new Error("boom"));
      store.getState().archiveRoom(JOB, "room-1");
      expect(store.getState().roomsByJob[JOB]!.map((r) => r.id)).toEqual(["room-2"]);

      await flush();
      expect(store.getState().roomsByJob[JOB]!.map((r) => r.id)).toEqual(["room-1", "room-2"]);
    });
  });

  describe("scanRoom", () => {
    it("adopts the server DTO on a done scan — no optimistic row beforehand", async () => {
      captureRoom.mockResolvedValue({
        status: "done",
        rawPayload: { raw: true },
        geometry: { walls: [] },
        capturedAt: "2026-07-01T00:00:00.000Z",
      });
      mutate.ingestScan.mockResolvedValue({
        id: "scan-1",
        jobId: JOB,
        roomName: "Kitchen",
        source: "roomplan_v1",
        capturedAt: "2026-07-01T00:00:00.000Z",
        quantities: [{ kind: "walls_sqft", value: 120, derivedValue: 120, status: "derived" }],
      });

      const result = await store.getState().scanRoom(JOB, "Kitchen");

      expect(result?.id).toBe("scan-1");
      expect(store.getState().roomsByJob[JOB]).toHaveLength(1);
      expect(store.getState().roomsByJob[JOB]![0]!.id).toBe("scan-1");
      expect(mutate.ingestScan).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB,
          roomName: "Kitchen",
          capturedAt: "2026-07-01T00:00:00.000Z",
          rawPayload: { raw: true },
          geometry: { walls: [] },
        }),
      );
    });

    it("is a no-op when the user cancels the scan", async () => {
      captureRoom.mockResolvedValue({ status: "cancelled" });

      const result = await store.getState().scanRoom(JOB, "Kitchen");

      expect(result).toBeNull();
      expect(store.getState().roomsByJob[JOB] ?? []).toHaveLength(0);
      expect(mutate.ingestScan).not.toHaveBeenCalled();
    });

    it("reports and rethrows when the native capture itself fails", async () => {
      captureRoom.mockRejectedValue(new Error("plugin exploded"));

      await expect(store.getState().scanRoom(JOB, "Kitchen")).rejects.toThrow("plugin exploded");
      expect(reportWriteError).toHaveBeenCalledWith("scanRoom", expect.any(Error));
      expect(store.getState().roomsByJob[JOB] ?? []).toHaveLength(0);
    });

    it("reports and rethrows when the server mutation fails", async () => {
      captureRoom.mockResolvedValue({
        status: "done",
        rawPayload: {},
        geometry: {},
        capturedAt: "2026-07-01T00:00:00.000Z",
      });
      mutate.ingestScan.mockRejectedValue(new Error("server boom"));

      await expect(store.getState().scanRoom(JOB, "Kitchen")).rejects.toThrow("server boom");
      expect(reportWriteError).toHaveBeenCalledWith("scanRoom", expect.any(Error));
      expect(store.getState().roomsByJob[JOB] ?? []).toHaveLength(0);
    });
  });

  describe("rescanRoom", () => {
    beforeEach(() => {
      store.getState().setJobRooms(JOB, [room({ id: "room-1", roomName: "Kitchen" })]);
    });

    it("REPLACES the old capture id with the new one (supersede)", async () => {
      captureRoom.mockResolvedValue({
        status: "done",
        rawPayload: { raw: true },
        geometry: { walls: [] },
        capturedAt: "2026-07-02T00:00:00.000Z",
      });
      mutate.rescan.mockResolvedValue({
        id: "room-2",
        jobId: JOB,
        roomName: "Kitchen",
        source: "roomplan_v1",
        capturedAt: "2026-07-02T00:00:00.000Z",
        quantities: [{ kind: "walls_sqft", value: 130, derivedValue: 130, status: "derived" }],
      });

      const result = await store.getState().rescanRoom(JOB, "room-1", "Kitchen");

      expect(result?.id).toBe("room-2");
      const ids = store.getState().roomsByJob[JOB]!.map((r) => r.id);
      expect(ids).toEqual(["room-2"]);
      expect(ids).not.toContain("room-1");
      expect(mutate.rescan).toHaveBeenCalledWith(
        expect.objectContaining({
          captureId: "room-1",
          rawPayload: { raw: true },
          geometry: { walls: [] },
          capturedAt: "2026-07-02T00:00:00.000Z",
        }),
      );
    });

    it("is a no-op when the user cancels the rescan", async () => {
      captureRoom.mockResolvedValue({ status: "cancelled" });

      const result = await store.getState().rescanRoom(JOB, "room-1", "Kitchen");

      expect(result).toBeNull();
      expect(store.getState().roomsByJob[JOB]!.map((r) => r.id)).toEqual(["room-1"]);
      expect(mutate.rescan).not.toHaveBeenCalled();
    });

    it("reports and rethrows when the server mutation fails, leaving the old room in place", async () => {
      captureRoom.mockResolvedValue({
        status: "done",
        rawPayload: {},
        geometry: {},
        capturedAt: "2026-07-02T00:00:00.000Z",
      });
      mutate.rescan.mockRejectedValue(new Error("supersede conflict"));

      await expect(store.getState().rescanRoom(JOB, "room-1", "Kitchen")).rejects.toThrow(
        "supersede conflict",
      );
      expect(reportWriteError).toHaveBeenCalledWith("rescanRoom", expect.any(Error));
      expect(store.getState().roomsByJob[JOB]!.map((r) => r.id)).toEqual(["room-1"]);
    });
  });
});
