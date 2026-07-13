/**
 * components/modals/lead-modal/lead-header.tsx
 * Faithful port of prototype openLead header row (lines 6137-6160).
 * Avatar (46px, initials) + editable name input + pill row (stage+src+phone) + action buttons.
 * NO emojis on buttons. NO "Move stage" bar.
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/store/types";
import { STAGE_PILL_CLS, leadInitials } from "@/lib/prototype-sample";
import { useAppStore, useOpenModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { hasPhone, ADD_PHONE_TITLE } from "@/lib/phone";
import { AddressInput } from "@/components/ui/address-input";

interface LeadHeaderProps {
  lead: Lead;
}

export function LeadHeader({ lead }: LeadHeaderProps) {
  const updateLead = useAppStore((s) => s.updateLead);
  const openModal = useOpenModal();
  const closeModal = useCloseModal();
  const router = useRouter();

  // "New quote" → the real quote composer, pre-populated with this customer
  // (the /composer route seeds its customer from ?lead=). Close the modal first
  // so it doesn't float over the composer page.
  function newQuote() {
    closeModal();
    router.push(`/composer?lead=${lead.id}`);
  }

  const [nameVal, setNameVal] = useState(lead.name);
  const [addrVal, setAddrVal] = useState(lead.address ?? "");

  // Re-sync if the lead prop changes (modal reopening with a different lead).
  useEffect(() => {
    setAddrVal(lead.address ?? "");
  }, [lead.id, lead.address]);

  function saveName() {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== lead.name) {
      updateLead(lead.id, { name: trimmed });
    }
  }

  const stageCls = STAGE_PILL_CLS[lead.stage] ?? "ink";
  const initials = leadInitials(lead.name);

  // Stage-aware primary action: a brand-new lead you haven't reached → the first
  // move is to Call; once you're past that, quoting is the money action.
  const callIsPrimary = lead.stage === "New customer";

  return (
    <div style={{ marginBottom: 18 }}>
      {/* Header: avatar beside a column of name + metadata, both left-aligned
          to each other; right padding keeps the editable name clear of the ✕. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
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
        <div style={{ flex: 1, minWidth: 0, paddingRight: 34 }}>
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

          {/* Metadata line: soft stage pill (dot carries the color) · source · phone */}
          <div className="lead-meta" style={{ marginTop: 7 }}>
            <span className={`stage-pill ${stageCls}`}>
              <span className="dot" aria-hidden="true" />
              {lead.stage}
            </span>
            {lead.source && (
              <>
                <span className="lead-meta-dot" aria-hidden="true">·</span>
                <span className="lead-meta-src">{lead.source}</span>
              </>
            )}
            {lead.companyId && lead.role && (
              <>
                <span className="lead-meta-dot" aria-hidden="true">·</span>
                <span className="lead-meta-src">{lead.role}</span>
              </>
            )}
            <span className="lead-meta-dot" aria-hidden="true">·</span>
            <input
              key={lead.phone}
              className="lead-phone"
              type="tel"
              defaultValue={lead.phone}
              placeholder="Add phone"
              onBlur={(e) => updateLead(lead.id, { phone: e.target.value })}
              aria-label="Customer phone"
            />
          </div>
        </div>
      </div>

      {/* Service address — surfaced up top (field service lives or dies on the
          address); editable inline, not buried under "More details". */}
      <label
        className="lead-addr-row"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
          border: "1.5px solid var(--line)",
          borderRadius: 10,
          padding: "8px 11px",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
          aria-hidden="true"
        >
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <AddressInput
          value={addrVal}
          onChange={setAddrVal}
          onSelect={(v) => updateLead(lead.id, { address: v })}
          onBlur={() => updateLead(lead.id, { address: addrVal })}
          placeholder="Add service address"
          aria-label="Service address"
          inputStyle={{
            flex: 1,
            border: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: 13.5,
            color: "var(--ink)",
            outline: "none",
            padding: 0,
          }}
        />
      </label>

      {/* Action buttons — grouped by intent so it doesn't read as a flat wall:
          CONTACT (Call / Text — quiet utilities) on the left, ADVANCE THE DEAL
          (Book site visit / New quote — the workflow) on the right. One clear
          stage-aware primary: Call for a brand-new lead, else New quote. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Contact cluster — Call/Text dial the phone; without one on file they'd
            open a blank call sheet / a thread that errors on send, so they disable
            (the phone input to add one is in the header above). */}
        <button
          className={`btn sm${callIsPrimary ? " primary" : " ghost"}`}
          disabled={!hasPhone(lead)}
          title={!hasPhone(lead) ? ADD_PHONE_TITLE : undefined}
          onClick={() => openModal(MODAL.CALL, { leadId: lead.id, returnTo: MODAL.LEAD })}
        >
          <PhoneIcon /> Call
        </button>
        <button
          className="btn sm ghost"
          disabled={!hasPhone(lead)}
          title={!hasPhone(lead) ? ADD_PHONE_TITLE : undefined}
          onClick={() => openModal(MODAL.THREAD, { leadId: lead.id, returnTo: MODAL.LEAD })}
        >
          <ChatIcon /> Text
          {lead.unread ? (
            <span className="pill blue" style={{ marginLeft: 6, padding: "1px 6px", fontSize: 10 }}>new</span>
          ) : null}
        </button>

        {/* Thin divider between contact and advance-the-deal clusters */}
        <span
          style={{ width: 1, alignSelf: "stretch", background: "var(--line)", margin: "3px 5px" }}
          aria-hidden="true"
        />
        {lead.stage !== "Won" && lead.stage !== "Lost" && (
          <button
            className="btn sm"
            onClick={() => openModal(MODAL.VISIT, { leadId: lead.id, returnTo: MODAL.LEAD })}
          >
            Book site visit
          </button>
        )}
        <button
          className={`btn sm${callIsPrimary ? "" : " primary"}`}
          onClick={newQuote}
        >
          New quote
        </button>
      </div>
      {!hasPhone(lead) && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          No phone on file — add one in the header above.
        </div>
      )}
    </div>
  );
}

// Small inline icons so Call / Text read as quick utilities, not heavy buttons.
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: "-2px" }} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: "-2px" }} aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
