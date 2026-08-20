"use client";

/**
 * Line depth editors — the two panels that expand IN-FLOW under a line row
 * (never a popover): scope prose the customer reads, and sub-items, the
 * estimating math they never see.
 *
 * Scope is plain text rendered pre-wrap on the quote — numbered lists are
 * typed as literal "1." lines, which is exactly how the $2-15M shops' PDF
 * proposals already read. Sub-items roll up into the line's rate via
 * withSubPatch (the LineTable owns that patch); this file only edits rows.
 */

import { fmt$ } from "@/lib/format";
import { emptySubItem, subItemsTotal, type ComposerSubItem } from "./composer-state";

/** Mirrors the domain's MAX_SCOPE_CHARS — the boundary rejects anything longer. */
const SCOPE_MAX = 8000;

export function ScopeEditor({
  value,
  lineNo,
  onChange,
}: {
  value: string;
  lineNo: number;
  onChange: (scope: string) => void;
}) {
  const rows = Math.min(14, Math.max(4, value.split("\n").length + 1));
  return (
    <div className="linedepth">
      <div className="linedepth-head">
        <span className="linedepth-tag">¶ Scope — the customer reads this under the line</span>
      </div>
      <textarea
        className="linedepth-scope"
        value={value}
        rows={rows}
        maxLength={SCOPE_MAX}
        placeholder={"Includes:\n1. …\n\nExcludes: …\n\nProducts & sheen: …"}
        aria-label={`Scope, line ${lineNo}`}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SubItemEditor({
  sub,
  lineNo,
  onChange,
}: {
  sub: ComposerSubItem[];
  lineNo: number;
  onChange: (sub: ComposerSubItem[]) => void;
}) {
  const rows = sub.length > 0 ? sub : [emptySubItem()];
  const patchRow = (i: number, patch: Partial<ComposerSubItem>) =>
    onChange(rows.map((si, n) => (n === i ? { ...si, ...patch } : si)));
  return (
    <div className="linedepth">
      <div className="linedepth-head">
        <span className="linedepth-tag">↳ Sub-items — your estimate math, never shown to the customer</span>
        <span className="linedepth-total">{fmt$(subItemsTotal(rows))}</span>
      </div>
      {rows.map((si, i) => (
        <div className="subrow" key={i}>
          <input
            value={si.d}
            placeholder="Walls & ceilings — 2 coats"
            aria-label={`Sub-item ${i + 1} description, line ${lineNo}`}
            onChange={(e) => patchRow(i, { d: e.target.value })}
          />
          <input
            type="number"
            inputMode="decimal"
            className="num"
            value={si.q}
            aria-label={`Sub-item ${i + 1} quantity, line ${lineNo}`}
            onChange={(e) => patchRow(i, { q: +e.target.value })}
          />
          <input
            value={si.unit ?? ""}
            placeholder="sq ft"
            aria-label={`Sub-item ${i + 1} unit, line ${lineNo}`}
            onChange={(e) => patchRow(i, { unit: e.target.value || undefined })}
          />
          <input
            type="number"
            inputMode="decimal"
            className="num"
            value={si.amt}
            aria-label={`Sub-item ${i + 1} amount, line ${lineNo}`}
            onChange={(e) => patchRow(i, { amt: +e.target.value })}
          />
          <button
            type="button"
            className="lineedit-tool"
            aria-label={`Remove sub-item ${i + 1}, line ${lineNo}`}
            title="Remove this sub-item"
            onClick={() => onChange(rows.filter((_, n) => n !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="linedepth-foot">
        <button type="button" className="linehint" onClick={() => onChange([...rows, emptySubItem()])}>
          + Add sub-item
        </button>
        <span className="linedepth-note">Amounts roll up into the line&apos;s price.</span>
      </div>
    </div>
  );
}
