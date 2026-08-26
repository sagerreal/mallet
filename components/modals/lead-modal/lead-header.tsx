/**
 * components/modals/lead-modal/lead-header.tsx
 * The sheet header: the customer's name as a real <h2> (tap to rename) over one
 * calm metadata line (stage pill · source). Sticky, so the record you are looking
 * at never scrolls away — the old header put an avatar, an always-mounted name
 * input, an inline phone input and four buttons here; every one of those now has a
 * single home further down the sheet.
 *
 * The name is a HEADING until you ask to change it. As a permanently-mounted input
 * it gave the modal no title, and #237's control-border floor
 * (`input…{border-color:var(--line-strong)!important}`) painted a box around it —
 * mounting the input only while editing keeps that floor honest: the thing is
 * bounded exactly when it IS a control. That behaviour now lives in
 * EditableSheetTitle, shared with the job sheet.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { EditableSheetTitle } from "../editable-sheet-title";

export function LeadSheetHeader({ lead }: { lead: Lead }) {
  const updateLead = useAppStore((s) => s.updateLead);

  return (
    <div className="sheet-head">
      {/* The same tap-to-rename heading the job sheet uses. A blank name is refused here — a
          customer with no name is unfindable — and EditableSheetTitle puts the old one back. */}
      <EditableSheetTitle
        value={lead.name}
        display={lead.name}
        onCommit={(name) => {
          if (name) updateLead(lead.id, { name });
        }}
        label="Customer name"
      />
      {/* One constant-weight meta line: stage + tags. The phone number does NOT
          live here — it had two homes (header meta when filled, quiet row when
          empty), which left nowhere obvious to edit it. The Phone row below is its
          only home in every state.

          Tags replaced `source` here. Source is machine-written provenance now and no screen
          edits it, so leaving it would have pinned "Added manually" — true of 122 customers on
          the live book — to the top of the record with no way to change it. */}
      <div className="sheet-meta">
        <span className={`stage-pill ${stagePillCls(lead.stage)}`}>
          <span className="dot" aria-hidden="true" />
          {lead.stage}
        </span>
        {lead.tags?.length ? <span>{lead.tags.join(", ")}</span> : null}
        {/* customer > quote > job > invoice. THE ONLY plural anchor: a customer accumulates quotes,
            jobs and invoices over years, so these positions carry counts and open a chooser. Two
            unique indexes make the chain 1:1 downstream, so the other three sheets are singular. */}
        <Trail kind="customer" id={lead.id} />
      </div>
    </div>
  );
}

import { STAGE_PILL_CLS } from "@/lib/prototype-sample";
import { Trail } from "../trail";
function stagePillCls(stage: string): string {
  return STAGE_PILL_CLS[stage] ?? "ink";
}

/** Inline phone editor — commit on blur/Enter, adopt outside changes when unfocused. */
export function PhoneCell({ value, onCommit }: { value: string; onCommit: (phone: string) => void }) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused && value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value, focused]);

  const commit = () => {
    const next = draft.trim();
    if (next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };

  return (
    <input
      className="lead-phone"
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={draft}
      placeholder="(925) 555-0123"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
      }}
      aria-label="Customer phone"
      style={{ width: "100%", minHeight: 44, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "0 var(--space-3)", fontSize: "var(--type-md)" }}
    />
  );
}
