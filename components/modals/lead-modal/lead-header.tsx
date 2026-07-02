/**
 * components/modals/lead-modal/lead-header.tsx
 * Name (inline edit), phone (inline edit), stage/source pills, action buttons.
 */

"use client";

import { useState } from "react";
import type { Lead } from "@/lib/store/types";
import { STAGE_PILL_CLS } from "@/lib/prototype-sample";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface LeadHeaderProps {
  lead: Lead;
}

export function LeadHeader({ lead }: LeadHeaderProps) {
  const updateLead = useAppStore((s) => s.updateLead);
  const openModal = useOpenModal();

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(lead.name);

  function saveName() {
    if (nameVal.trim()) updateLead(lead.id, { name: nameVal.trim() });
    setEditingName(false);
  }

  const stageCls = STAGE_PILL_CLS[lead.stage] ?? "ink";

  return (
    <div>
      {/* Inline-edit name */}
      {editingName ? (
        <input
          className="lead-name"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
          autoFocus
        />
      ) : (
        <h2
          style={{ cursor: "pointer", marginBottom: 6 }}
          onClick={() => setEditingName(true)}
          title="Click to edit"
        >
          {lead.name}
        </h2>
      )}

      {/* Phone + stage + source meta row */}
      <div className="nmeta" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input
          className="lead-phone"
          defaultValue={lead.phone}
          placeholder="Phone"
          onBlur={(e) => updateLead(lead.id, { phone: e.target.value })}
        />
        <span className={`stamp ${stageCls}`}>{lead.stage}</span>
        {lead.source && <span className="pill src">{lead.source}</span>}
        {lead.unread && (
          <span className="pill blue">new text</span>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.CALL, { leadId: lead.id })}
        >
          📞 Call
        </button>
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.THREAD, { leadId: lead.id })}
        >
          💬 Text{lead.unread ? " ●" : ""}
        </button>
        {lead.stage !== "Won" && lead.stage !== "Lost" && (
          <button
            className="btn sm"
            onClick={() => openModal(MODAL.VISIT, { leadId: lead.id })}
          >
            🏠 Book visit
          </button>
        )}
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.COMPOSER, { leadId: lead.id })}
        >
          + New quote
        </button>
      </div>
    </div>
  );
}
