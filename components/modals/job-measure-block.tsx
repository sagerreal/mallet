/**
 * components/modals/job-measure-block.tsx
 * The job modal's "Measurements" block — room captures (RoomPlan scans or
 * manual rooms) for this job. Mirrors job-checklist-block.tsx: a card-free
 * list of tap rows inside the accordion body, plus a trailing "+ Add room"
 * control that drills into the room-card modal (Task 8 builds that sheet).
 *
 * Rooms hydrate lazily via useJobRooms(jobId) (features/measurements) — the
 * hook itself returns the react-query result; rooms are read back from the
 * store's roomsByJob slice, matching how the hook is documented to be used.
 *
 * The room-card modal is a drill-in from an already-open sheet (the job
 * modal), so it PUSHES onto the modal back-stack like the other in-modal
 * drill-ins (PRICE_BUILDER from PriceSummary, CALL/THREAD from the header) —
 * closing it returns to the job modal rather than dead-ending blank.
 */

"use client";

import { useJobRooms } from "@/features/measurements/use-job-rooms";
import { usePushModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { Row } from "@/components/ui/row";
import { Badge } from "@/components/ui/badge";
import type { RoomCard, RoomQuantity, RoomQuantityKind } from "@/lib/store/types";

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
  useJobRooms(jobId);
  const rooms = useAppStore((s) => s.roomsByJob[jobId] ?? []);
  const pushModal = usePushModal();

  return (
    <div>
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

      <button
        type="button"
        className="btn sm"
        style={{ marginTop: "var(--space-2)" }}
        onClick={() => pushModal(MODAL.ROOM_CARD, { jobId })}
      >
        + Add room
      </button>
    </div>
  );
}
