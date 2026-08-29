"use client";

/**
 * features/money/po-line-table.tsx
 *
 * ONE LINE TABLE, IMPORTED BY BOTH PO MODALS. Not two copies kept in step by hand — that drift is
 * exactly what Owen objected to. The create modal and the view modal render this same component,
 * so the columns, widths, header band, placeholder text and empty state cannot diverge.
 *
 * THERE IS NO "RECEIVED" COLUMN, because there is no receiving. These orders are not used to check
 * a delivery in against what was ordered, so a receipt quantity would be a field nobody fills and a
 * number the app quietly gets wrong. What the line says is what was bought.
 *
 * `readOnly` renders the SAME markup with disabled inputs rather than swapping to text, because
 * `.lineedit input:disabled` already carries the dead-field styling — a locked line still reads as
 * the same line it was.
 */

import { DraftNumberInput } from "@/components/shared/draft-number-input";
import { PO_LINE_COLS, lineCents } from "./po-defs";
import type { PurchaseOrderLine } from "@/lib/store/types";

const money = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** DraftNumberInput forwards `style`, not `className` — a className here is silently dropped. */
const NUM: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

interface POLineTableProps {
  lines: readonly PurchaseOrderLine[];
  /** Omit to lock the grid — a PO's quantities and prices freeze once the order is placed. */
  onChange?: (id: string, patch: Partial<PurchaseOrderLine>) => void;
  onRemove?: (id: string) => void;
  onAdd?: () => void;
  readOnly?: boolean;
}

export function POLineTable({ lines, onChange, onRemove, onAdd, readOnly }: POLineTableProps) {
  const locked = readOnly || !onChange;

  return (
    <div className="lineedit po-lines">
      <table>
        <colgroup>
          <col />
          {/* Sized for the 15px body, not the 13px .lineedit default — at the old widths
              "UNIT COST" wrapped onto two lines and pushed the header band taller. */}
          <col style={{ width: 80 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 124 }} />
          <col style={{ width: 108 }} />
          {!locked && <col style={{ width: 40 }} />}
        </colgroup>
        <thead>
          <tr>
            {PO_LINE_COLS.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined}>{c.label}</th>
            ))}
            {!locked && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={locked ? 5 : 6} className="muted" style={{ padding: "var(--space-4)", textAlign: "center" }}>
                Nothing on this order yet.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <input
                    type="text"
                    value={l.description}
                    disabled={locked}
                    placeholder="what you are buying"
                    aria-label="Item"
                    onChange={(e) => onChange?.(l.id, { description: e.target.value })}
                  />
                </td>
                <td>
                  <DraftNumberInput
                    style={NUM}
                    value={l.qty}
                    decimals={2}
                    disabled={locked}
                    aria-label="Qty"
                    onCommit={(v) => onChange?.(l.id, { qty: v })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={l.uom}
                    disabled={locked}
                    placeholder="ea"
                    aria-label="Unit"
                    onChange={(e) => onChange?.(l.id, { uom: e.target.value })}
                  />
                </td>
                <td>
                  {/* DraftNumberInput, never a raw number input parsed per keystroke — that is the
                      pattern that turned "2.0" into 20 on a real money field. */}
                  <DraftNumberInput
                    style={NUM}
                    value={l.unitCostMillicents / 100_000}
                    decimals={2}
                    disabled={locked}
                    aria-label="Unit cost"
                    onCommit={(v) => onChange?.(l.id, { unitCostMillicents: Math.round(v * 100_000) })}
                  />
                </td>
                <td className="num" style={{ textAlign: "right", paddingRight: "var(--space-3)", fontVariantNumeric: "tabular-nums" }}>
                  <b>{money(lineCents(l))}</b>
                </td>
                {!locked && (
                  <td>
                    <button
                      type="button"
                      className="linklike"
                      style={{ color: "var(--red)", fontSize: "var(--type-md)" }}
                      aria-label={`Remove ${l.description || "line"}`}
                      onClick={() => onRemove?.(l.id)}
                    >
                      ✕
                    </button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {!locked && (
        <div className="lineedit-bar">
          {/* No "· or pull one from the pricebook" — nothing wires a pricebook pull, and a house
              rule against dead controls covers copy that advertises one just as much as a button
              that does. */}
          <button type="button" className="linklike" onClick={onAdd}>
            + Add a line
          </button>
        </div>
      )}
    </div>
  );
}
