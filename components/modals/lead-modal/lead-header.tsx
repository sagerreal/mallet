/**
 * components/modals/lead-modal/lead-header.tsx
 * Faithful port of prototype openLead header row (lines 6137-6160).
 * Avatar (46px, initials) + editable name input + pill row (stage+src+phone) + action buttons.
 * NO emojis on buttons. NO "Move stage" bar.
 */

"use client";

import { useState } from "react";
import type { Lead } from "@/lib/store/types";
import { STAGE_PILL_CLS, leadInitials } from "@/lib/prototype-sample";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface LeadHeaderProps {
  lead: Lead;
}

export function LeadHeader({ lead }: LeadHeaderProps) {
  const updateLead = useAppStore((s) => s.updateLead);
  const openModal = useOpenModal();

  const [nameVal, setNameVal] = useState(lead.name);

  function saveName() {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== lead.name) {
      updateLead(lead.id, { name: trimmed });
    }
  }

  const stageCls = STAGE_PILL_CLS[lead.stage] ?? "ink";
  const initials = leadInitials(lead.name);

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Top row: avatar + name input */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div
          className="avatar"
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "var(--green-100)",
            color: "var(--green-900)",
            fontSize: 15,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <input
          className="lead-name"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-label="Customer name"
        />
      </div>

      {/* Pill row: stage stamp + src pill + phone input */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <span className={`stamp ${stageCls}`}>{lead.stage}</span>
        {lead.source && <span className="pill src">{lead.source}</span>}
        {lead.companyId && lead.role && (
          <span className="pill gray">{lead.role}</span>
        )}
        <input
          className="lead-phone"
          type="tel"
          defaultValue={lead.phone}
          placeholder="Phone"
          onBlur={(e) => updateLead(lead.id, { phone: e.target.value })}
          aria-label="Customer phone"
        />
      </div>

      {/* Action buttons — no emojis, exactly as prototype */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.CALL, { leadId: lead.id })}
        >
          Call
        </button>
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.THREAD, { leadId: lead.id })}
        >
          Text{lead.unread ? <span className="pill blue" style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>new</span> : null}
        </button>
        {lead.stage !== "Won" && lead.stage !== "Lost" && (
          <button
            className="btn sm"
            onClick={() => openModal(MODAL.VISIT, { leadId: lead.id })}
          >
            Book site visit
          </button>
        )}
        <button
          className="btn sm primary"
          onClick={() => openModal(MODAL.COMPOSER, { leadId: lead.id })}
        >
          New quote
        </button>
      </div>
    </div>
  );
}
