import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { shouldSeedJobRooms } from "./use-job-rooms";
import { createMeasurementsSlice, type MeasurementsSlice } from "@/lib/store/slices/measurements-slice";
import type { RoomCard } from "@/lib/store/types";

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      measurements: {
        createManualRoom: { mutate: vi.fn().mockReturnValue(new Promise(() => {})) }, // never resolves — stays "in-flight"
        overrideQuantity: { mutate: vi.fn() },
        confirmQuantity: { mutate: vi.fn() },
        renameRoom: { mutate: vi.fn().mockResolvedValue({ captureId: "room-1", roomName: "Primary Kitchen" }) },
        archiveRoom: { mutate: vi.fn() },
      },
    },
  },
}));

const JOB = "job-1";

const room = (overrides: Partial<RoomCard> = {}): RoomCard => ({
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

describe("shouldSeedJobRooms", () => {
  it("allows seeding when the slice has never been populated for this job (undefined)", () => {
    expect(shouldSeedJobRooms(undefined)).toBe(true);
  });

  it("refuses to reseed once the job has any rooms, including a legitimately empty list", () => {
    expect(shouldSeedJobRooms([])).toBe(false);
    expect(shouldSeedJobRooms([room()])).toBe(false);
  });
});

// Regression guard for the revert/data-loss path: a hydrator that unconditionally re-seeds
// on every mount would overwrite a just-persisted edit with a stale cached list response
// when the job modal is closed and reopened. Simulates: seed (first load) -> optimistic
// edit -> "remount" delivering stale server data -> guarded seed is skipped -> edit survives.
describe("useJobRooms seed-once guard — remount with stale data does not revert an edit", () => {
  let store: StoreApi<MeasurementsSlice>;

  beforeEach(() => {
    store = createStore<MeasurementsSlice>((set, get, api) => createMeasurementsSlice(set, get, api));
  });

  it("preserves a store edit across a simulated remount carrying stale data", () => {
    // 1. First load: hydrator seeds the store (existing was undefined -> seed allowed).
    const initial = [room({ roomName: "Kitchen" })];
    expect(shouldSeedJobRooms(store.getState().roomsByJob[JOB])).toBe(true);
    store.getState().setJobRooms(JOB, initial);

    // 2. User optimistically renames the room while the modal is open.
    store.getState().renameRoom(JOB, "room-1", "Primary Kitchen");
    expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Primary Kitchen");

    // 3. Modal closes and reopens. react-query serves its cached (stale) response from
    //    BEFORE the rename — the guard must refuse to seed because the job already has rooms.
    const staleServerData = [room({ roomName: "Kitchen" })];
    expect(shouldSeedJobRooms(store.getState().roomsByJob[JOB])).toBe(false);
    // (the hook would skip calling setJobRooms here — nothing to invoke, guard already false)
    void staleServerData;

    // 4. The store edit survives the remount.
    expect(store.getState().roomsByJob[JOB]![0]!.roomName).toBe("Primary Kitchen");
  });

  it("does not wipe an in-flight optimistic add on remount", () => {
    store.getState().setJobRooms(JOB, []); // first load: job genuinely has no rooms yet
    expect(shouldSeedJobRooms(store.getState().roomsByJob[JOB])).toBe(false);

    // Optimistic add fires (persist not yet resolved).
    const { room: added } = store.getState().addManualRoom(JOB, "New Room", [
      { kind: "walls_sqft", value: 50 },
    ]);
    expect(store.getState().roomsByJob[JOB]!.some((r) => r.id === added.id)).toBe(true);

    // Remount delivers a stale (pre-add) empty list — guard refuses to seed, so the
    // in-flight optimistic row is not wiped out from under its own reconcile.
    expect(shouldSeedJobRooms(store.getState().roomsByJob[JOB])).toBe(false);
    expect(store.getState().roomsByJob[JOB]!.some((r) => r.id === added.id)).toBe(true);
  });
});
