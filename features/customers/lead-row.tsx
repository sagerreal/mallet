/**
 * features/customers/lead-row.tsx
 * Single table row + per-column cell renderer (mirrors prototype leadCell).
 * Click → openModal(MODAL.LEAD, { leadId }) via prop.
 */

"use client";

import type { Lead } from "@/lib/store/types";
import { StagePill, SrcPill } from "@/components/shared/stage-pill";
import { ALL_COL_DEFS } from "./customers-columns";
import { fmt$ } from "@/lib/format";
import { pressable } from "@/lib/a11y";


interface LeadCellProps {
  lead: Lead;
  col: string;
}

function LeadCell({ lead, col }: LeadCellProps) {
  switch (col) {
    case "name":
      return (
        <b>
          {lead.name}
          {lead.unread && (
            <span className="pill blue" style={{ marginLeft: "var(--space-2)" }}>
              new text
            </span>
          )}
        </b>
      );
    case "phone":
      return <>{lead.phone || <span className="muted">—</span>}</>;
    case "source":
      return <SrcPill src={lead.source} />;
    case "stage":
      return <StagePill stage={lead.stage} />;
    case "latest":
      return <span className="muted">{lead.last ?? ""}</span>;
    case "age":
      return <>{lead.age}d</>;
    case "email":
      return <>{lead.email ?? <span className="muted">—</span>}</>;
    case "address":
      return <>{lead.address ?? <span className="muted">—</span>}</>;
    default:
      return null;
  }
}

interface LeadRowProps {
  lead: Lead;
  visibleCols: string[];
  onOpen: (id: string) => void;
  /** Present on the Archived view only — renders a Restore cell (archive is a state
      on this list, not a place; restore moved here from the retired Settings tab). */
  onRestore?: (id: string) => void;
}

export function LeadRow({ lead, visibleCols, onOpen, onRestore }: LeadRowProps) {
  return (
    <tr className="clickable" onClick={() => onOpen(lead.id)} {...pressable(() => onOpen(lead.id))}>
      {visibleCols.map((col) => (
        <td key={col} data-label={ALL_COL_DEFS[col]?.l} data-primary={col === "name" ? "" : undefined}>
          <LeadCell lead={lead} col={col} />
        </td>
      ))}
      {onRestore && (
        <td data-label="Restore">
          <button
            className="btn sm"
            aria-label={`Restore ${lead.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRestore(lead.id);
            }}
          >
            ↩ Restore
          </button>
        </td>
      )}
    </tr>
  );
}
