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
 * bounded exactly when it IS a control.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";

export function LeadSheetHeader({ lead }: { lead: Lead }) {
  const updateLead = useAppStore((s) => s.updateLead);

  const [nameVal, setNameVal] = useState(lead.name);
  const [editingName, setEditingName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNameVal(lead.name);
    setEditingName(false);
  }, [lead.id, lead.name]);

  useEffect(() => {
    if (editingName) nameRef.current?.focus();
  }, [editingName]);

  function saveName() {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== lead.name) {
      updateLead(lead.id, { name: trimmed });
    }
    setEditingName(false);
  }

  return (
    <div className="sheet-head">
      {editingName ? (
        <input
          ref={nameRef}
          className="lead-name"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setNameVal(lead.name);
              setEditingName(false);
            }
          }}
          aria-label="Customer name"
        />
      ) : (
        <h2 className="lead-title">
          <button
            type="button"
            className="lead-title-edit"
            onClick={() => setEditingName(true)}
            aria-label={`${lead.name} — rename`}
          >
            {lead.name}
          </button>
        </h2>
      )}
      {/* One constant-weight meta line: stage + source. The phone number does NOT
          live here — it had two homes (header meta when filled, quiet row when
          empty), which left nowhere obvious to edit it. The Phone row below is its
          only home in every state. */}
      <div className="sheet-meta">
        <span className={`stage-pill ${stagePillCls(lead.stage)}`}>
          <span className="dot" aria-hidden="true" />
          {lead.stage}
        </span>
        {lead.source && <span>{lead.source}</span>}
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
