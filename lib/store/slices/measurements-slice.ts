/**
 * lib/store/slices/measurements-slice.ts
 * Room captures ("measurements") — job-scoped, keyed by jobId. NOT seeded by the
 * global hydrator config: see features/measurements/use-job-rooms.ts for why this
 * domain hydrates lazily per job instead. Immutable updates only.
 *
 * All write actions are OPTIMISTIC + PERSIST + RECONCILE:
 *   1. Apply local change immediately so the UI is instant.
 *   2. Fire the matching v1.measurements mutation via trpcVanilla.
 *   3. On success, reconcile the returned DTO (whole room, or the touched quantity).
 *   4. On error, ROLL BACK to the pre-mutation snapshot, reportWriteError, rethrow —
 *      callers must surface the failure (no silent failures).
 *
 * overrideQuantity and confirmQuantity are both exported as raw actions (the router
 * genuinely has two mutations), but the UI should call setRoomQuantity — it reads the
 * quantity's CURRENT status and routes to the correct mutation, so a single "type a
 * number" affordance works whether the room started as a needs-confirm scan value or
 * an already-derived one.
 */

import type { StateCreator } from "zustand";
import type { RoomCard, RoomQuantity, RoomQuantityKind } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { roomCaptureDtoToStore } from "@/lib/store/measurements-mapper";
import { reportWriteError } from "../write-error";

export interface MeasurementsSlice {
  roomsByJob: Record<string, RoomCard[]>;
  /** Replace one job's rooms — called by useJobRooms on hydration/reconcile. */
  setJobRooms: (jobId: string, rooms: RoomCard[]) => void;
  addManualRoom: (
    jobId: string,
    roomName: string,
    quantities: readonly { kind: RoomQuantityKind; value: number }[],
  ) => RoomCard;
  overrideQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  confirmQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  /** Routes to overrideQuantity or confirmQuantity based on the quantity's current status. */
  setRoomQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  renameRoom: (jobId: string, captureId: string, roomName: string) => void;
  archiveRoom: (jobId: string, captureId: string) => void;
}

function findQuantity(
  rooms: RoomCard[],
  captureId: string,
  kind: RoomQuantityKind,
): RoomQuantity | undefined {
  return rooms.find((r) => r.id === captureId)?.quantities.find((q) => q.kind === kind);
}

/** Replace a single quantity on a single room, immutably. */
function withQuantity(
  rooms: RoomCard[],
  captureId: string,
  kind: RoomQuantityKind,
  patch: Partial<RoomQuantity>,
): RoomCard[] {
  return rooms.map((r) =>
    r.id === captureId
      ? { ...r, quantities: r.quantities.map((q) => (q.kind === kind ? { ...q, ...patch } : q)) }
      : r,
  );
}

export const createMeasurementsSlice: StateCreator<
  MeasurementsSlice,
  [],
  [],
  MeasurementsSlice
> = (set, get) => ({
  roomsByJob: {},

  setJobRooms: (jobId, rooms) =>
    set((s) => ({ roomsByJob: { ...s.roomsByJob, [jobId]: rooms } })),

  addManualRoom: (jobId, roomName, quantities) => {
    // Mint a client-authored UUID — the server preserves it as the row id.
    const id = crypto.randomUUID();
    const room: RoomCard = {
      id,
      jobId,
      roomName: roomName.trim() || "Room",
      source: "manual",
      capturedAt: new Date().toISOString(),
      quantities: quantities.map((q) => ({
        kind: q.kind,
        value: q.value,
        derivedValue: null,
        status: "confirmed",
      })),
    };

    // Optimistic append — UI reflects the new room immediately.
    set((s) => ({
      roomsByJob: { ...s.roomsByJob, [jobId]: [...(s.roomsByJob[jobId] ?? []), room] },
    }));

    // Persist; reconcile with the server-canonical room (all quantity kinds, derived values).
    trpcVanilla.v1.measurements.createManualRoom
      .mutate({
        id,
        jobId,
        roomName: room.roomName,
        quantities: quantities.map((q) => ({ kind: q.kind, value: q.value })),
      })
      .then((dto) => {
        const reconciled = roomCaptureDtoToStore(dto);
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: (s.roomsByJob[jobId] ?? []).map((r) => (r.id === id ? reconciled : r)),
          },
        }));
      })
      .catch((err: unknown) => {
        reportWriteError("addManualRoom", err);
        // Rollback: remove the optimistic room.
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: (s.roomsByJob[jobId] ?? []).filter((r) => r.id !== id),
          },
        }));
      });

    return room;
  },

  overrideQuantity: (jobId, captureId, kind, value) => {
    const snapshot = get().roomsByJob[jobId] ?? [];

    // Optimistic update.
    set((s) => ({
      roomsByJob: {
        ...s.roomsByJob,
        [jobId]: withQuantity(s.roomsByJob[jobId] ?? [], captureId, kind, {
          value,
          status: "override",
        }),
      },
    }));

    trpcVanilla.v1.measurements.overrideQuantity
      .mutate({ captureId, kind, value })
      .then((dto) => {
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: withQuantity(s.roomsByJob[jobId] ?? [], captureId, kind, {
              value: dto.value,
              derivedValue: dto.derivedValue,
              status: dto.status,
            }),
          },
        }));
      })
      .catch((err: unknown) => {
        reportWriteError("overrideQuantity", err);
        set((s) => ({ roomsByJob: { ...s.roomsByJob, [jobId]: snapshot } }));
      });
  },

  confirmQuantity: (jobId, captureId, kind, value) => {
    const snapshot = get().roomsByJob[jobId] ?? [];

    // Optimistic update.
    set((s) => ({
      roomsByJob: {
        ...s.roomsByJob,
        [jobId]: withQuantity(s.roomsByJob[jobId] ?? [], captureId, kind, {
          value,
          status: "confirmed",
        }),
      },
    }));

    trpcVanilla.v1.measurements.confirmQuantity
      .mutate({ captureId, kind, value })
      .then((dto) => {
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: withQuantity(s.roomsByJob[jobId] ?? [], captureId, kind, {
              value: dto.value,
              derivedValue: dto.derivedValue,
              status: dto.status,
            }),
          },
        }));
      })
      .catch((err: unknown) => {
        reportWriteError("confirmQuantity", err);
        set((s) => ({ roomsByJob: { ...s.roomsByJob, [jobId]: snapshot } }));
      });
  },

  setRoomQuantity: (jobId, captureId, kind, value) => {
    const current = findQuantity(get().roomsByJob[jobId] ?? [], captureId, kind);
    const action = current?.status === "needs_confirm" ? get().confirmQuantity : get().overrideQuantity;
    action(jobId, captureId, kind, value);
  },

  renameRoom: (jobId, captureId, roomName) => {
    const snapshot = get().roomsByJob[jobId] ?? [];
    const trimmed = roomName.trim() || "Room";

    // Optimistic update.
    set((s) => ({
      roomsByJob: {
        ...s.roomsByJob,
        [jobId]: (s.roomsByJob[jobId] ?? []).map((r) =>
          r.id === captureId ? { ...r, roomName: trimmed } : r,
        ),
      },
    }));

    trpcVanilla.v1.measurements.renameRoom
      .mutate({ captureId, roomName: trimmed })
      .then((dto) => {
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: (s.roomsByJob[jobId] ?? []).map((r) =>
              r.id === dto.captureId ? { ...r, roomName: dto.roomName } : r,
            ),
          },
        }));
      })
      .catch((err: unknown) => {
        reportWriteError("renameRoom", err);
        set((s) => ({ roomsByJob: { ...s.roomsByJob, [jobId]: snapshot } }));
      });
  },

  archiveRoom: (jobId, captureId) => {
    const snapshot = get().roomsByJob[jobId] ?? [];

    // Optimistic remove.
    set((s) => ({
      roomsByJob: {
        ...s.roomsByJob,
        [jobId]: (s.roomsByJob[jobId] ?? []).filter((r) => r.id !== captureId),
      },
    }));

    trpcVanilla.v1.measurements.archiveRoom
      .mutate({ captureId })
      .catch((err: unknown) => {
        reportWriteError("archiveRoom", err);
        // Rollback: restore the pre-archive snapshot (order preserved).
        set((s) => ({ roomsByJob: { ...s.roomsByJob, [jobId]: snapshot } }));
      });
  },
});
