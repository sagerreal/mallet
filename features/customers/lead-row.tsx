/**
 * features/customers/lead-row.tsx
 * Single table row + per-column cell renderer (mirrors prototype leadCell).
 * Click → openModal(MODAL.LEAD, { leadId }) via prop.
 */

"use client";

import type { Lead } from "@/lib/store/types";
import { LEAD_GROUP_LABELS, type LeadGroup } from "@/modules/customers/infra/lead-views";
import { StagePill, SrcPill } from "@/components/shared/stage-pill";
import { ALL_COL_DEFS } from "./customers-columns";
import { fmt$, agoShort, fmtPhone } from "@/lib/format";
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
      // The stored value is E.164 (the domain Phone, persisted as phoneE164), so the raw column
      // read "+15105550199" while every other surface showed "(510) 555-0199".
      return <>{lead.phone ? fmtPhone(lead.phone) : <span className="muted">—</span>}</>;
    case "tags":
      // One pill per tag, in the order the office chose them. An untagged customer gets the same
      // em-dash every other empty cell in this table uses — not an empty pill, which reads as a
      // tag whose name failed to load.
      return lead.tags?.length ? (
        <span className="tagcell">
          {lead.tags.map((t) => (
            <SrcPill key={t} src={t} />
          ))}
        </span>
      ) : (
        <span className="muted">—</span>
      );
    case "stage":
      // The DERIVED group, never the stored `lead.stage`. That column read "New customer" on every
      // row of a 678-customer book because nothing maintains it; this is computed from estimates,
      // visits and invoices and cannot go stale. Falls back only where no list read supplied one.
      return <StagePill stage={lead.group ? LEAD_GROUP_LABELS[lead.group as LeadGroup] ?? lead.stage : lead.stage} />;
    case "latest":
      return <span className="muted">{agoShort(lead.lastActivityAt)}</span>;
    case "value":
      // Was missing entirely — the column existed in the picker and rendered nothing, which is
      // how fmt$ came to be imported here and never called.
      return <>{lead.value ? fmt$(lead.value) : <span className="muted">—</span>}</>;
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
