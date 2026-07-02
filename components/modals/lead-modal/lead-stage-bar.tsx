/**
 * components/modals/lead-modal/lead-stage-bar.tsx
 * Stage change controls + footer actions (Clean up / Delete).
 */

"use client";

import type { Lead } from "@/lib/store/types";
import { useAppStore, useOpenModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

const STAGES = ["New customer", "Contacted", "Quote Sent", "Won", "Lost"] as const;

interface LeadStageBarProps {
  lead: Lead;
}

export function LeadStageBar({ lead }: LeadStageBarProps) {
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const deleteLead = useAppStore((s) => s.deleteLead);
  const openModal = useOpenModal();
  const closeModal = useCloseModal();

  function handleDelete() {
    if (!confirm(`Delete ${lead.name}? This cannot be undone.`)) return;
    deleteLead(lead.id);
    closeModal();
  }

  return (
    <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
      {/* Stage picker */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600, marginBottom: 8 }}>
          Move stage
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STAGES.map((s) => (
            <button
              key={s}
              className={`btn sm${lead.stage === s ? " primary" : " ghost"}`}
              onClick={() => moveLeadStage(lead.id, s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          className="btn ghost sm"
          onClick={() => openModal(MODAL.CLEAN_UP, { leadId: lead.id })}
        >
          Clean up
        </button>
        <button
          className="btn ghost sm"
          style={{ color: "var(--red)" }}
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
