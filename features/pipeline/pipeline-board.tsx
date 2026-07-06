/**
 * features/pipeline/pipeline-board.tsx
 * Renders all stage columns + lost bar.
 * Owns the useMemo filter logic for boardQ search.
 * Owns the drag-and-drop hook and threads handlers down.
 */

"use client";

import { useMemo } from "react";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Lead, Estimate } from "@/lib/store/types";
import { PipelineColumn } from "./pipeline-column";
import { PipelineLostBar } from "./pipeline-lost-bar";
import { useLeadDrag } from "./use-lead-drag";
import { STAGE_ORDER } from "./pipeline-constants";

interface PipelineBoardProps {
  leads: Lead[];
  estimates: Estimate[];
  boardQ: string;
}

export function PipelineBoard({ leads, estimates, boardQ }: PipelineBoardProps) {
  const dragHandlers = useLeadDrag();
  const openModal = useOpenModal();

  const q = boardQ.toLowerCase();

  const boardLeads = useMemo(() => {
    // Exclude book:true (direct-booked) and archived leads from the board
    let ls = leads.filter((l) => !l.book && !l.archived);
    if (q) {
      ls = ls.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.job ?? "").toLowerCase().includes(q)
      );
    }
    return ls;
  }, [leads, q]);

  const lostLeads = useMemo(
    () => leads.filter((l) => !l.archived && l.stage === "Lost"),
    [leads]
  );

  return (
    <>
      <div className="board">
        {STAGE_ORDER.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            leads={boardLeads}
            estimates={estimates}
            dragHandlers={dragHandlers}
          />
        ))}
      </div>

      <PipelineLostBar lostLeads={lostLeads} />

      {/* Trash zone — CSS shows it only when body.dragging class is active */}
      <div
        id="trashzone"
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("hot");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("hot")}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("hot");
          // Capture the id BEFORE onDragEnd clears it, then open Clean-up on it.
          const leadId = dragHandlers.getDragId();
          dragHandlers.onDragEnd();
          if (leadId != null) openModal(MODAL.CLEAN_UP, { leadId });
        }}
      >
        Drop to clean up — mark Lost or Archive
      </div>
    </>
  );
}
