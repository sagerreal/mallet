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
  value: number | null;
}

function LeadCell({ lead, col, value }: LeadCellProps) {
  switch (col) {
    case "name":
      return (
        <b>
          {lead.name}
          {lead.unread && (
            <span className="pill blue" style={{ marginLeft: 6 }}>
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
    case "value":
      return value != null ? (
        <b className="fig">{fmt$(value)}</b>
      ) : (
        <span className="muted">—</span>
      );
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
  value: number | null;
  onOpen: (id: string) => void;
}

export function LeadRow({ lead, visibleCols, value, onOpen }: LeadRowProps) {
  return (
    <tr className="clickable" onClick={() => onOpen(lead.id)} {...pressable(() => onOpen(lead.id))}>
      {visibleCols.map((col) => (
        <td key={col} data-label={ALL_COL_DEFS[col]?.l} data-primary={col === "name" ? "" : undefined}>
          <LeadCell lead={lead} col={col} value={value} />
        </td>
      ))}
    </tr>
  );
}
