/**
 * components/modals/room-card-modal.tsx
 * Room card drill-in — opened from JobMeasureBlock, either to view/edit an
 * existing room capture ({ captureId, jobId }) or to create a manual room
 * ({ jobId } only, no captureId).
 *
 * PLACEHOLDER — Task 8 fills in the quantity list, override/confirm actions,
 * and the manual-room create form. This stub only resolves the sheet head so
 * the modal typechecks, registers, and renders without crashing when opened.
 */

"use client";

import { useActiveModal, useAppStore } from "@/lib/store/app-store";

export function RoomCardModalContent() {
  const activeModal = useActiveModal();
  const jobId = activeModal?.params?.jobId as string | undefined;
  const captureId = activeModal?.params?.captureId as string | undefined;

  const room = useAppStore((s) =>
    jobId && captureId ? s.roomsByJob[jobId]?.find((r) => r.id === captureId) : undefined,
  );

  return (
    <div>
      <div className="sheet-head">
        <h2>{room?.roomName?.trim() || "Room"}</h2>
      </div>
      {/* Task 8 fills this in */}
    </div>
  );
}
