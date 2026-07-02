/**
 * features/pipeline/pipeline-card.tsx
 * Single lead card for the kanban board.
 * Click → openModal(MODAL.LEAD, { leadId }).
 * Draggable via HTML5 drag API (handlers injected from parent).
 */

"use client";

import type { Lead, Estimate } from "@/lib/store/types";
import { MODAL } from "@/lib/store/modal-ids";
import { useOpenModal } from "@/lib/store/app-store";
import { stageNorm } from "./pipeline-constants";
import type { DragHandlers } from "./use-lead-drag";

// ---- helpers ----------------------------------------------------------------

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function estTotal(e: Estimate): number {
  const p = e.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const sub = e.lines.filter((l) => !l.opt).reduce((s, l) => s + l.q * l.r, 0);
  const disc = sub * ((p.disc ?? 0) / 100);
  return (sub - disc) * (1 + (p.tax ?? 0) / 100);
}

function leadVal(lead: Lead, estimates: Estimate[]): number {
  const e = estimates.find((e) => e.leadId === lead.id && e.status !== "draft");
  return e ? estTotal(e) : (lead.value ?? 0);
}

function isScopedNeedsQuote(lead: Lead, estimates: Estimate[]): boolean {
  if (lead.stage === "Won" || lead.stage === "Lost") return false;
  const visited = (lead.evisits ?? []).some(
    (v) => (v as { scopeNotes?: string }).scopeNotes
  );
  return visited && !estimates.some((e) => e.leadId === lead.id);
}

// ---- types ------------------------------------------------------------------

interface PipelineCardProps {
  lead: Lead;
  estimates: Estimate[];
  compact: boolean;
  dragHandlers: DragHandlers;
}

// ---- component --------------------------------------------------------------

export function PipelineCard({
  lead,
  estimates,
  compact,
  dragHandlers,
}: PipelineCardProps) {
  const openModal = useOpenModal();
  const scoped = isScopedNeedsQuote(lead, estimates);
  const flagged = lead.age > stageNorm(lead.stage);
  const val = leadVal(lead, estimates);
  const accentStyle: React.CSSProperties = scoped
    ? { borderLeft: "3px solid var(--amber)" }
    : {};

  function handleClick() {
    openModal(MODAL.LEAD, { leadId: lead.id });
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    dragHandlers.onDragStart(e, lead.id);
  }

  if (compact) {
    return (
      <div
        className={`kcard mini${flagged ? " flag" : ""}`}
        style={accentStyle}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={dragHandlers.onDragEnd}
        onClick={handleClick}
      >
        <span className="nm-mini">{lead.name}</span>
        <span className="mini-meta">
          {scoped && (
            <span
              className="pill amber"
              style={{ fontSize: "9.5px", padding: "1px 5px" }}
            >
              quote it
            </span>
          )}{" "}
          {val ? fmt$(val) + " · " : ""}
          {lead.age}d
        </span>
      </div>
    );
  }

  return (
    <div
      className={`kcard${flagged ? " flag" : ""}`}
      style={accentStyle}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={dragHandlers.onDragEnd}
      onClick={handleClick}
    >
      <div className="nm">
        <span>
          {lead.unread && <span style={{ color: "var(--blue)" }}> </span>}
          {lead.name}
        </span>
        <span>{val ? fmt$(val) : ""}</span>
      </div>
      <div className="muted" style={{ marginTop: 3 }}>
        {lead.job ?? ""}
      </div>
      {scoped ? (
        <div
          style={{
            marginTop: 7,
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
          }}
        >
          <span className="pill amber">● Scoped — needs quote</span>
          <button
            className="btn primary sm"
            onClick={(e) => {
              e.stopPropagation();
              openModal(MODAL.COMPOSER, { leadId: lead.id });
            }}
          >
            Build quote
          </button>
        </div>
      ) : (
        <div className="meta">
          <span className="pill src">{lead.source}</span>
          <span className="days">{lead.age}d</span>
        </div>
      )}
    </div>
  );
}
