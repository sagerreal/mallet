/**
 * components/modals/job-measure-block.tsx
 * The job modal's "Measurements" block — room captures (RoomPlan scans or
 * manual rooms) for this job. Mirrors job-checklist-block.tsx: a card-free
 * list of tap rows inside the accordion body, plus a trailing "+ Add room"
 * control that drills into the room-card modal.
 *
 * Rooms hydrate lazily via useJobRooms(jobId) (features/measurements) — the
 * hook returns the react-query result, which this block reads directly for
 * its error state (house rule: no silent failures on interactive paths). A
 * FAILED list fetch must never render as "no rooms": shouldShowLoadFailed
 * (lib/first-run.ts) fires only when the query errored AND the store has
 * nothing cached for this job, same predicate + LoadFailed pairing
 * checklists-panel.tsx uses for its list query. Rooms themselves are read
 * back from the store's roomsByJob slice.
 *
 * The room-card modal is a drill-in from an already-open sheet (the job
 * modal), so it PUSHES onto the modal back-stack like the other in-modal
 * drill-ins (PRICE_BUILDER from PriceSummary, CALL/THREAD from the header) —
 * closing it returns to the job modal instead of dead-ending blank.
 */

"use client";

import { useJobRooms } from "@/features/measurements/use-job-rooms";
import { useRoomScanAvailable } from "@/lib/native/room-scan";
import { usePushModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { shouldShowLoadFailed } from "@/lib/first-run";
import { LoadFailed } from "@/components/shared/load-failed";
import { Row } from "@/components/ui/row";
import { Badge } from "@/components/ui/badge";
import type { RoomCard, RoomQuantity, RoomQuantityKind } from "@/lib/store/types";

// Stable empty-array fallback — MUST live outside the selector. A selector that
// returns a fresh `[]` literal when the job has no roomsByJob entry hands
// useSyncExternalStore a new reference on every getSnapshot call; React sees
// the snapshot as "changed" on every render and infinite-loops until the error
// boundary trips ("Maximum update depth exceeded"). Select the raw value,
// apply the fallback to it outside the selector, same as job-modal.tsx's
// `rooms` selector.
const EMPTY_ROOMS: readonly RoomCard[] = [];

/** A quantity's value: an office override/confirm wins over the derived scan value. */
function quantityValue(q: RoomQuantity | undefined): number | null {
  if (!q) return null;
  return q.value ?? q.derivedValue ?? null;
}

function findQuantity(quantities: RoomQuantity[], kind: RoomQuantityKind): RoomQuantity | undefined {
  return quantities.find((q) => q.kind === kind);
}

/**
 * Headline for a room row — "562 sqft walls · 2 doors" built from walls_sqft
 * and doors_count when present. Falls back to a generic label when neither is
 * on the card yet (e.g. a freshly-created manual room with no quantities).
 * Exported for unit testing.
 */
export function roomHeadline(quantities: RoomQuantity[]): string {
  const parts: string[] = [];

  const walls = quantityValue(findQuantity(quantities, "walls_sqft"));
  if (walls != null) parts.push(`${walls} sqft walls`);

  const doors = quantityValue(findQuantity(quantities, "doors_count"));
  if (doors != null) parts.push(`${doors} door${doors === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(" · ") : "Not measured yet";
}

/** True when any quantity on the room is awaiting office confirmation. */
export function roomNeedsConfirm(room: RoomCard): boolean {
  return room.quantities.some((q) => q.status === "needs_confirm");
}

export function JobMeasureBlock({ jobId }: { jobId: string }) {
  const query = useJobRooms(jobId);
  const rooms = useAppStore((s) => s.roomsByJob[jobId]) ?? EMPTY_ROOMS;
  const pushModal = usePushModal();
  const scanAvailable = useRoomScanAvailable();

  // A failed fetch must never be mistaken for "no rooms" — only render the
  // friendly empty state once the query has genuinely succeeded (or the store
  // already has rooms cached from an earlier successful load).
  const loadFailed = shouldShowLoadFailed({
    isFetched: query.isFetched,
    isError: query.isError,
    count: rooms.length,
  });

  return (
    <div>
      {loadFailed ? (
        <LoadFailed
          noun="rooms"
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : (
        <>
          {rooms.map((room) => (
            <Row
              key={room.id}
              label={room.roomName}
              value={roomHeadline(room.quantities)}
              trailing={roomNeedsConfirm(room) ? <Badge tone="amber">Confirm</Badge> : undefined}
              onClick={() => pushModal(MODAL.ROOM_CARD, { captureId: room.id, jobId })}
            />
          ))}

          {rooms.length === 0 && (
            <div className="empty-att" style={{ marginBottom: "var(--space-2)" }}>
              No rooms measured yet.
            </div>
          )}
        </>
      )}

      {scanAvailable ? (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          <button
            type="button"
            className="btn sm"
            onClick={() => pushModal(MODAL.ROOM_CARD, { jobId })}
          >
            + Add room
          </button>

          <button
            type="button"
            className="btn sm"
            onClick={() => pushModal(MODAL.ROOM_CARD, { jobId, mode: "scan" })}
          >
            Scan room
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn sm"
          style={{ marginTop: "var(--space-2)" }}
          onClick={() => pushModal(MODAL.ROOM_CARD, { jobId })}
        >
          + Add room
        </button>
      )}
    </div>
  );
}
