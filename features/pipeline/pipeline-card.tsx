/**
 * features/pipeline/pipeline-card.tsx
 * Single lead card for the kanban board.
 * Click → openModal(MODAL.LEAD, { leadId }).
 * Draggable via HTML5 drag API (handlers injected from parent).
 */

"use client";

import { useRouter } from "next/navigation";
import type { Lead, Estimate } from "@/lib/store/types";
import { MODAL } from "@/lib/store/modal-ids";
import { useOpenModal } from "@/lib/store/app-store";
import { stageNorm } from "./pipeline-constants";
import { leadVal, isScopedNeedsQuote } from "./pipeline-utils";
import type { DragHandlers } from "./use-lead-drag";
import { fmt$ } from "@/lib/format";

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
  const router = useRouter();
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
          {lead.unread && (
            <span style={{ color: "var(--blue)", fontSize: 9, verticalAlign: 2 }} title="New text">
              ●{" "}
            </span>
          )}
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
              router.push(`/composer?lead=${lead.id}`);
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
