"use client";

/**
 * Line editor — one contained surface (border, header band, rows, footer
 * toolbar) shared by the single-quote body and the GBB tier panels.
 *
 * Design rules: inputs are transparent (the row is the surface, focus draws
 * the ring); numerics right-align; per-row actions stay invisible until the
 * row is hovered/focused, except active states (✓ Optional, ✓ Photo) which
 * persist. The footer toolbar owns "+ Add line" plus whatever tools the
 * caller passes (Draft with AI / From pricebook / Show your cost) so the
 * card above stays bare: title + format toggle, nothing else.
 *
 * A line may be an ASSEMBLY — priced from the components beneath it, each counted off its
 * quantity ("qty/8+1" posts for a fence run). Components are rows, not a panel: they are money,
 * and money belongs in the ledger. The table owns the array arithmetic (adding, removing and
 * re-parenting shift every index, and a wrong index moves money into another assembly), so the
 * caller receives a finished array and only has to store it.
 *
 * Accessibility: every cell input carries an explicit aria-label naming its column and row
 * ("Quantity, line 2"). The <th> column headers do NOT name these inputs — a screen reader
 * announcing a bare spinbutton is what axe's `label` rule flags, and it went unnoticed while an
 * empty composer hid this table behind a hero.
 *
 * Row actions are deliberately minimal: Optional (customer-facing choice), No tax (only once
 * the quote carries a rate — with no rate nothing is taxed and the chip would decide nothing),
 * + Component, and remove. Save-to-book died when the estimator's learning loop took over
 * feeding the pricebook; the Photo chip returns when it attaches real photos.
 */

import { Fragment, useId, useState } from "react";
import { realSubItems, withSubPatch, type ComposerLine } from "./composer-state";
import { ScopeEditor, SubItemEditor } from "./line-depth";
import { LineRow } from "./line-row";
import { componentIndexes, removeLineAt, addComponent, withRollUps } from "./line-math";

export function LineTable({
  lines,
  showCost,
  onLines,
  footerTools,
  materialize,
  provenanceFor,
  taxed = false,
  priceMode = "lines",
}: {
  lines: ComposerLine[];
  showCost: boolean;
  /**
   * The whole array after an edit, already rolled up. One callback rather than
   * update/add/remove: every structural change re-indexes the components, and three callers
   * each doing that arithmetic is how one of them gets it wrong.
   */
  onLines: (next: ComposerLine[]) => void;
  /** Extra tools for the footer toolbar (uniform .lineedit-tool styling). */
  footerTools?: React.ReactNode;
  /** Brief post-draft window: rows animate in (CSS only, reduced-motion safe). */
  materialize?: boolean;
  /** Optional per-line provenance caption ("pricebook") — B3. Null hides it. */
  provenanceFor?: (description: string) => "pricebook" | null;
  /**
   * Does this quote charge sales tax at all. Gates the per-line No-tax chip: with no rate on
   * the quote nothing is taxed, so the chip would be a control that decides nothing.
   */
  taxed?: boolean;
  /** 'total' dims the amount column — those numbers stay yours; the customer sees one price. */
  priceMode?: "lines" | "total";
}) {
  const cols = showCost ? 7 : 6;
  // GBB renders three LineTables at once — panel ids must be unique per instance or every
  // tier's aria-controls points at whichever twin rendered first.
  const uid = useId();
  // Which lines have their depth editors open. Presence of DATA lives on the line itself;
  // these sets are only the expand/collapse UI state, so they reset harmlessly on unmount.
  const [scopeOpen, setScopeOpen] = useState<ReadonlySet<number>>(new Set());
  const [subOpen, setSubOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (set: ReadonlySet<number>, i: number): ReadonlySet<number> => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };
  // Rows are index-keyed, so removing one shifts every index above it. Remap both open-sets
  // through the removal or an open panel silently re-attaches under the WRONG line — inviting
  // customer-facing scope prose to be typed into a different line's editor.
  const dropIndexes = (set: ReadonlySet<number>, removed: ReadonlySet<number>): ReadonlySet<number> => {
    const next = new Set<number>();
    for (const n of set) {
      if (removed.has(n)) continue;
      next.add(n - [...removed].filter((r) => r < n).length);
    }
    return next;
  };
  const shiftIndexes = (set: ReadonlySet<number>, insertedAt: number): ReadonlySet<number> => {
    const next = new Set<number>();
    for (const n of set) next.add(n >= insertedAt ? n + 1 : n);
    return next;
  };

  // Every write funnels through here so a component edit always reprices its parent.
  const commit = (next: ComposerLine[]) => onLines(withRollUps(next));

  const updateLine = (i: number, patch: Partial<ComposerLine>) =>
    commit(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const removeLine = (i: number) => {
    const removed = new Set<number>([i, ...componentIndexes(lines, i)]);
    setScopeOpen(dropIndexes(scopeOpen, removed));
    setSubOpen(dropIndexes(subOpen, removed));
    commit(removeLineAt(lines, i));
  };

  const addComponentTo = (parentIndex: number) => {
    const existing = componentIndexes(lines, parentIndex);
    const at = (existing[existing.length - 1] ?? parentIndex) + 1;
    setScopeOpen(shiftIndexes(scopeOpen, at));
    setSubOpen(shiftIndexes(subOpen, at));
    commit(addComponent(lines, parentIndex, { d: "", q: 1, r: 0, qtyExpr: "qty" }));
  };

  const addLine = () => commit([...lines, { d: "", q: 1, r: 0 }]);

  /** The depth toggles under a description — scope prose, and sub-items on quotes that have them. */
  const hintsFor = (line: ComposerLine, i: number) => {
    const hasContent = Boolean(line.d && line.d.trim());
    const subs = realSubItems(line.sub).length;
    const hasDepth = Boolean(line.scope?.trim()) || subs > 0;
    if (!hasContent && !hasDepth) return null;
    return (
      <div className="linehints">
        <button
          type="button"
          className="linehint"
          aria-expanded={scopeOpen.has(i)}
          aria-controls={`${uid}-scope-${i}`}
          title="Scope prose the customer reads under this line — Includes, Excludes, Products"
          onClick={() => setScopeOpen(toggle(scopeOpen, i))}
        >
          {line.scope?.trim() ? "¶ Scope" : "¶ Add scope"}
        </button>
        {/* Sub-items predate components and mean the same thing, so they are offered only on
            the quotes that already carry them — those stay editable, nothing new grows one. */}
        {subs > 0 && (
          <button
            type="button"
            className="linehint"
            aria-expanded={subOpen.has(i)}
            aria-controls={`${uid}-sub-${i}`}
            title="Your estimate math — rolls up into this line's price, never shown to the customer"
            onClick={() => setSubOpen(toggle(subOpen, i))}
          >
            ↳ Sub-items ({subs})
          </button>
        )}
      </div>
    );
  };

  /** A row plus whichever depth editors it has open. Shared by lines and their components. */
  const renderRow = (line: ComposerLine, i: number, parent?: ComposerLine, lastComponent?: boolean) => {
    const components = componentIndexes(lines, i);
    const hasContent = Boolean(line.d && line.d.trim());
    const hasDepth = Boolean(line.scope?.trim()) || realSubItems(line.sub).length > 0;
    return (
      <Fragment key={i}>
        <LineRow
          line={line}
          index={i}
          parent={parent}
          hasComponents={components.length > 0}
          showCost={showCost}
          taxed={taxed}
          priceMode={priceMode}
          lastComponent={lastComponent}
          provenanceFor={provenanceFor}
          onUpdate={(patch) => updateLine(i, patch)}
          onRemove={() => removeLine(i)}
          onAddComponent={() => addComponentTo(i)}
          hints={hintsFor(line, i)}
        />
        {(hasContent || hasDepth) && scopeOpen.has(i) && (
          <tr className="linedetail">
            <td colSpan={cols} id={`${uid}-scope-${i}`}>
              <ScopeEditor
                value={line.scope ?? ""}
                lineNo={i + 1}
                onChange={(scope) => updateLine(i, { scope: scope || undefined })}
              />
            </td>
          </tr>
        )}
        {(hasContent || hasDepth) && subOpen.has(i) && (
          <tr className="linedetail">
            <td colSpan={cols} id={`${uid}-sub-${i}`}>
              <SubItemEditor
                sub={line.sub ?? []}
                lineNo={i + 1}
                onChange={(sub) => {
                  const next = withSubPatch(line, sub);
                  updateLine(i, { sub: next.sub, r: next.r });
                }}
              />
            </td>
          </tr>
        )}
        {components.map((at, n) =>
          renderRow(lines[at]!, at, line, n === components.length - 1),
        )}
      </Fragment>
    );
  };

  return (
    <div className={`lineedit${materialize ? " materialize" : ""}`}>
      <table>
        <colgroup>
          <col />
          <col style={{ width: 84 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 96 }} />
          {showCost && <col style={{ width: 96 }} />}
          <col style={{ width: 104 }} />
          {/* Actions hold Optional + Component + ✕ — sized to fit, so AMOUNT no
              longer floats beside a wide dead zone. */}
          <col style={{ width: 190 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Price</th>
            {showCost && <th className="num">Your cost</th>}
            <th className="num">Amount</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (line.parentIndex == null ? renderRow(line, i) : null))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={cols}>
              <div className="lineedit-bar">
                <button type="button" className="lineedit-tool primary" onClick={addLine}>
                  + Add line
                </button>
                {footerTools}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
