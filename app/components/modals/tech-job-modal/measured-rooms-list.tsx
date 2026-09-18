"use client";

/**
 * components/modals/tech-job-modal/measured-rooms-list.tsx
 * The rooms a tech has measured on this job, each one a way INTO its room card.
 *
 * WHY IT EXISTS. The Quote tab counted rooms and said "1 room measured — open the price to see
 * what they came to", then offered only "Scan another room". So a painter who had just scanned a
 * bathroom could not see its numbers, could not correct one, could not record what is tiled, and
 * could not delete a room scanned by mistake — the count was the only evidence the scan had
 * happened at all. Everything needed already existed one modal away (MODAL.ROOM_CARD with a
 * captureId opens quantities, deductions, rename, re-scan and Remove room); the office composer
 * has listed rooms this way all along. Only the field surface never got the list.
 *
 * WHAT EACH ROW SHOWS. The name, and the wall area an estimate would actually price — net of
 * anything not painted. Never a bare gross number beside a room that carries deductions, or the
 * list would disagree with the quote it feeds.
 */

import type { RoomCard } from "@/lib/store/types";

/** The headline number: paintable walls, or the gross while nothing has been deducted. */
function wallsLabel(room: RoomCard): { text: string; hint: boolean } {
  const gross = room.quantities.find((q) => q.kind === "walls_sqft")?.value ?? null;
  const net = room.netWallsSqft;
  const shown = net ?? gross;

  // walls_sqft is null while it is needs_confirm — a scan that came back unreadable. Saying
  // "0 sq ft" there would read as a measured room with no walls.
  if (shown === null) return { text: "needs a number", hint: true };

  const deducted = room.deductions.length > 0;
  return { text: `${shown.toFixed(1)} sq ft walls${deducted ? " net" : ""}`, hint: false };
}

export interface MeasuredRoomsListProps {
  rooms: readonly RoomCard[];
  onOpenRoom: (captureId: string) => void;
}

export function MeasuredRoomsList({ rooms, onOpenRoom }: MeasuredRoomsListProps) {
  if (rooms.length === 0) return null;

  return (
    <ul className="mrl">
      {rooms.map((room) => {
        const walls = wallsLabel(room);
        return (
          <li key={room.id}>
            {/* A real button, not a clickable row: this is the only way to the room's numbers,
                and it has to be reachable by keyboard and announce itself. */}
            <button type="button" className="mrl-row" onClick={() => onOpenRoom(room.id)}>
              <span className="mrl-name">{room.roomName}</span>
              <span className={walls.hint ? "mrl-walls hint" : "mrl-walls"}>{walls.text}</span>
              <span className="mrl-go" aria-hidden="true">
                ›
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
