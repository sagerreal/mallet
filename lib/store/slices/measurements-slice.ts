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
 *
 * scanRoom / rescanRoom are the ONE exception to the optimistic-first pattern above: a
 * scan only exists once the native plugin has captured it and the server has parsed +
 * derived quantities from the geometry, so there is nothing honest to render before the
 * mutation resolves. They call the native bridge (lib/native/room-scan.ts), persist
 * server-side FIRST, then ADOPT the returned DTO into roomsByJob — no optimistic row, no
 * add*-style re-persist, per the store house rule for flows that already persisted
 * server-side. rescanRoom additionally REPLACES the old capture id with the new one
 * (supersede semantics) rather than patching in place.
 */

import type { StateCreator } from "zustand";
import type { RoomCard, RoomQuantity, RoomQuantityKind } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { roomCaptureDtoToStore } from "@/lib/store/measurements-mapper";
import { captureRoom } from "@/lib/native/room-scan";
import { reportWriteError } from "../write-error";

export interface MeasurementsSlice {
  roomsByJob: Record<string, RoomCard[]>;
  /** Replace one job's rooms — called by useJobRooms on hydration/reconcile. */
  setJobRooms: (jobId: string, rooms: RoomCard[]) => void;
  /**
   * `persisted` resolves with the reconciled (server-canonical) room, and REJECTS
   * on failure after rolling back — callers must surface the error (no silent
   * failures). Mirrors addLead (leads-slice.ts) / addChecklist (checklists-slice.ts).
   */
  addManualRoom: (
    jobId: string,
    roomName: string,
    quantities: readonly { kind: RoomQuantityKind; value: number }[],
  ) => { room: RoomCard; persisted: Promise<RoomCard> };
  overrideQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  confirmQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  /** Routes to overrideQuantity or confirmQuantity based on the quantity's current status. */
  setRoomQuantity: (jobId: string, captureId: string, kind: RoomQuantityKind, value: number) => void;
  renameRoom: (jobId: string, captureId: string, roomName: string) => void;
  /**
   * Record wall area this room does NOT get painted. `heightFt` is null for a whole-wall
   * deduction. NOT optimistic, deliberately: the square footage is derived server-side from the
   * capture's geometry, so the client cannot predict the number it is about to show — an
   * optimistic net would flash a wrong figure on a screen whose whole job is being right about
   * area. The whole room comes back and replaces itself.
   */
  addDeduction: (
    jobId: string,
    captureId: string,
    deduction: { reason: string; kind: "whole_wall" | "band"; wallIndexes: number[]; heightFt: number | null },
  ) => Promise<void>;
  /** Put deducted wall area back. Same server-derived reason for not being optimistic. */
  removeDeduction: (jobId: string, captureId: string, deductionId: string) => Promise<void>;
  archiveRoom: (jobId: string, captureId: string) => void;
  /**
   * Runs a native RoomPlan scan, persists it server-side, and adopts the resulting
   * RoomCard. Returns null (no-op) if the user cancelled the scan. Throws (after
   * reportWriteError) on any capture or persistence failure — callers show inline.
   */
  scanRoom: (jobId: string, roomName: string) => Promise<RoomCard | null>;
  /**
   * Re-scans an existing room: the new capture REPLACES the old one (by id) in
   * roomsByJob. Returns null (no-op) if the user cancelled the scan. Throws (after
   * reportWriteError) on any capture or persistence failure — callers show inline.
   */
  rescanRoom: (jobId: string, captureId: string, roomName: string) => Promise<RoomCard | null>;
}

function findQuantity(
  rooms: RoomCard[],
  captureId: string,
  kind: RoomQuantityKind,
): RoomQuantity | undefined {
  return rooms.find((r) => r.id === captureId)?.quantities.find((q) => q.kind === kind);
}

/** Replace one whole room by id, immutably. Unknown id leaves the list untouched. */
function withRoom(rooms: RoomCard[], next: RoomCard): RoomCard[] {
  return rooms.map((r) => (r.id === next.id ? next : r));
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
      // A manual room has no geometry: no walls to point at, so it can never carry a deduction,
      // and its wall area is edited directly instead.
      deductions: [],
      walls: [],
      netWallsSqft: null,
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
    // Resolves with the reconciled room, REJECTS on failure after rolling back.
    const persisted: Promise<RoomCard> = trpcVanilla.v1.measurements.createManualRoom
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
        return reconciled;
      })
      .catch((err: unknown) => {
        reportWriteError("addManualRoom", err);
        // Rollback: remove the optimistic room, then rethrow so the caller can tell the user.
        set((s) => ({
          roomsByJob: {
            ...s.roomsByJob,
            [jobId]: (s.roomsByJob[jobId] ?? []).filter((r) => r.id !== id),
          },
        }));
        throw err instanceof Error ? err : new Error("addManualRoom failed");
      });

    return { room, persisted };
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

  addDeduction: async (jobId, captureId, deduction) => {
    try {
      const dto = await trpcVanilla.v1.measurements.addDeduction.mutate({ captureId, ...deduction });
      set((s) => ({
        roomsByJob: { ...s.roomsByJob, [jobId]: withRoom(s.roomsByJob[jobId] ?? [], roomCaptureDtoToStore(dto)) },
      }));
    } catch (err: unknown) {
      // Rethrown after reporting: the caller renders the failure inline on the sheet, because a
      // deduction that silently did not save changes what the job costs.
      reportWriteError("addDeduction", err);
      throw err;
    }
  },

  removeDeduction: async (jobId, captureId, deductionId) => {
    try {
      const dto = await trpcVanilla.v1.measurements.removeDeduction.mutate({ captureId, deductionId });
      set((s) => ({
        roomsByJob: { ...s.roomsByJob, [jobId]: withRoom(s.roomsByJob[jobId] ?? [], roomCaptureDtoToStore(dto)) },
      }));
    } catch (err: unknown) {
      reportWriteError("removeDeduction", err);
      throw err;
    }
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

  scanRoom: async (jobId, roomName) => {
    let result;
    try {
      result = await captureRoom(roomName);
    } catch (err: unknown) {
      reportWriteError("scanRoom", err);
      throw err instanceof Error ? err : new Error("scanRoom failed");
    }

    if (result.status === "cancelled") return null;

    try {
      const dto = await trpcVanilla.v1.measurements.ingestScan.mutate({
        id: crypto.randomUUID(),
        jobId,
        roomName,
        capturedAt: result.capturedAt,
        rawPayload: result.rawPayload,
        geometry: result.geometry,
      });
      const room = roomCaptureDtoToStore(dto);

      // Server-persisted-first: adopt the DTO directly, no optimistic row to reconcile.
      set((s) => ({
        roomsByJob: {
          ...s.roomsByJob,
          [jobId]: [...(s.roomsByJob[jobId] ?? []), room],
        },
      }));

      return room;
    } catch (err: unknown) {
      reportWriteError("scanRoom", err);
      throw err instanceof Error ? err : new Error("scanRoom failed");
    }
  },

  rescanRoom: async (jobId, captureId, roomName) => {
    let result;
    try {
      result = await captureRoom(roomName);
    } catch (err: unknown) {
      reportWriteError("rescanRoom", err);
      throw err instanceof Error ? err : new Error("rescanRoom failed");
    }

    if (result.status === "cancelled") return null;

    try {
      const dto = await trpcVanilla.v1.measurements.rescan.mutate({
        captureId,
        rawPayload: result.rawPayload,
        geometry: result.geometry,
        capturedAt: result.capturedAt,
      });
      const room = roomCaptureDtoToStore(dto);

      // Supersede semantics: the old capture id is gone, replaced by the new one.
      set((s) => ({
        roomsByJob: {
          ...s.roomsByJob,
          [jobId]: (s.roomsByJob[jobId] ?? []).filter((r) => r.id !== captureId).concat(room),
        },
      }));

      return room;
    } catch (err: unknown) {
      reportWriteError("rescanRoom", err);
      throw err instanceof Error ? err : new Error("rescanRoom failed");
    }
  },
});
