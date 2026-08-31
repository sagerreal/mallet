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
import {
  componentIndexes,
  removeLineAt,
  addComponent,
  withRollUps,
  sectionTotal,
  removeSectionAt,
  assemblySyncState,
  type SavedComponent,
} from "./line-math";
import { fmt$ } from "@/lib/format";

export function LineTable({
  lines,
  sections = [],
  showCost,
  onLines,
  onSections,
  emptyTools,
  savedAssemblies,
  onSaveAssembly,
  footerTools,
  materialize,
  provenanceFor,
  taxed = false,
  priceMode = "lines",
}: {
  lines: ComposerLine[];
  /** Headings the lines are grouped under, in render order. Empty = an ungrouped quote. */
  sections?: string[];
  showCost: boolean;
  /**
   * The whole array after an edit, already rolled up. One callback rather than
   * update/add/remove: every structural change re-indexes the components, and three callers
   * each doing that arithmetic is how one of them gets it wrong.
   */
  onLines: (next: ComposerLine[]) => void;
  /**
   * Both arrays together, because removing a heading re-indexes every line that named one.
   * Absent means this table does not offer sections — the GBB tiers, where a heading per tier
   * would be three competing groupings of one quote.
   */
  onSections?: (next: { sections: string[]; lines: ComposerLine[] }) => void;
  /** Extra tools for the footer toolbar (uniform .lineedit-tool styling). */
  footerTools?: React.ReactNode;
  /** The subset of those tools worth offering on an EMPTY quote. Defaults to all of them. */
  emptyTools?: React.ReactNode;
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
  /**
   * The parts of each saved assembly in the shop's book, keyed by pricebook entry. What the
   * three states below are compared against. Absent means the book has not loaded — every
   * assembly then reads as unsaved, which is the honest answer while nothing is known.
   */
  savedAssemblies?: ReadonlyMap<string, readonly SavedComponent[]>;
  /** Save this assembly to the book. `itemId` present means overwrite; absent mints a new one. */
  onSaveAssembly?: (parentIndex: number, itemId: string | null) => void;
}) {
  const cols = showCost ? 8 : 6;
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

  /**
   * The optional lines, wherever they were typed. They render last, together — see the band
   * below. A component of an optional parent travels with it and is not listed here.
   */
  const optionalIndexes = lines.reduce<number[]>((found, line, i) => {
    if (line.parentIndex == null && line.opt) found.push(i);
    return found;
  }, []);
  const optionalTotal = optionalIndexes.reduce(
    (sum, i) => sum + Math.round((lines[i]!.q ?? 0) * (lines[i]!.r ?? 0) * 100),
    0,
  ) / 100;

  // Every write funnels through here so a component edit always reprices its parent.
  const commit = (next: ComposerLine[]) => onLines(withRollUps(next));

  const updateLine = (i: number, patch: Partial<ComposerLine>) =>
    commit(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // A patch can only SET a key. Dropping one — a typed price clearing its markup — needs the
  // whole line, so the two live side by side rather than one pretending to do both.
  const replaceLine = (i: number, next: ComposerLine) =>
    commit(lines.map((l, idx) => (idx === i ? next : l)));

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

  const addLine = (sectionIndex?: number) =>
    commit([...lines, sectionIndex == null ? { d: "", q: 1, r: 0 } : { d: "", q: 1, r: 0, sectionIndex }]);

  const addSection = () =>
    onSections?.({ sections: [...sections, `Section ${sections.length + 1}`], lines });

  const renameSection = (at: number, name: string) =>
    onSections?.({ sections: sections.map((s, i) => (i === at ? name : s)), lines });

  const removeSection = (at: number) => onSections?.(removeSectionAt(sections, lines, at));

  /**
   * The affordances under a description — scope prose, components, and sub-items on the quotes
   * that already carry them. They ride here rather than in the row-actions column because that
   * column is a fixed width holding chips, and a fourth control pushed the ✕ off the row.
   */
  const hintsFor = (line: ComposerLine, i: number, isComponent: boolean) => {
    const hasContent = Boolean(line.d && line.d.trim());
    const subs = realSubItems(line.sub).length;
    const components = componentIndexes(lines, i).length;
    const hasDepth = Boolean(line.scope?.trim()) || subs > 0 || components > 0;
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
        {/* A component cannot have components of its own — the document stays one level deep. */}
        {!isComponent && (
          <button
            type="button"
            className="linehint"
            title="Price this line from the parts and labour under it"
            onClick={() => addComponentTo(i)}
          >
            {components > 0 ? `↳ Add component (${components})` : "↳ Add component"}
          </button>
        )}
        {!isComponent && components > 0 && onSaveAssembly && bookControl(line, i)}
      </div>
    );
  };

  /**
   * Where this assembly stands against the shop's book: not in it, matching it, or drifted
   * from it. Three states, and each one offers only the action that state allows — an assembly
   * that matches the book offers nothing to press, because there is nothing to do.
   */
  const bookControl = (line: ComposerLine, i: number) => {
    const saved = line.pricebookItemId ? savedAssemblies?.get(line.pricebookItemId) : undefined;
    const state = assemblySyncState(line, componentIndexes(lines, i).map((at) => lines[at]!), saved);
    if (state === "synced") {
      return <span className="linehint-note">✓ In pricebook</span>;
    }
    if (state === "modified") {
      return (
        <>
          <button
            type="button"
            className="linehint"
            title="Overwrite the pricebook entry this came from"
            onClick={() => onSaveAssembly?.(i, line.pricebookItemId ?? null)}
          >
            ↑ Update in pricebook
          </button>
          <button
            type="button"
            className="linehint"
            title="Keep the entry it came from and save this as a separate one"
            onClick={() => onSaveAssembly?.(i, null)}
          >
            + Save as new
          </button>
        </>
      );
    }
    return (
      <button
        type="button"
        className="linehint"
        title="Save this assembly to your pricebook so you can quote it again"
        onClick={() => onSaveAssembly?.(i, null)}
      >
        + Save to pricebook
      </button>
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
          onReplace={(next) => replaceLine(i, next)}
          onRemove={() => removeLine(i)}
          hints={hintsFor(line, i, Boolean(parent))}
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

  // ZERO rows means untouched — the composer starts with none, exactly like the mock, so one
  // press of "+ Add line item" yields exactly one row. (The previous gate tolerated one blank
  // scaffolding row, and the first press appended a second.)
  if (lines.length === 0 && sections.length === 0) {
    return (
      <div className={`lineedit${materialize ? " materialize" : ""}`}>
        <div className="lineedit-empty">
          <b>No line items yet</b>
          <span>Add a line with a description, scope, and final price — or start from your pricebook.</span>
          <div className="lineedit-empty-acts">
            <button type="button" className="btn primary sm" onClick={() => addLine()}>
              + Add line item
            </button>
            {/* `emptyTools` and not the whole footer bar: "Show your cost" on a quote with no
                lines is a control that reveals nothing. */}
            {emptyTools ?? footerTools}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`lineedit${materialize ? " materialize" : ""}`}>
      <table>
        <colgroup>
          <col />
          <col style={{ width: 84 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 96 }} />
          {showCost && <col style={{ width: 96 }} />}
          {showCost && <col style={{ width: 72 }} />}
          <col style={{ width: 104 }} />
          {/* Actions hold the chips + ✕ — sized to fit, so AMOUNT no longer floats
              beside a wide dead zone. Adding a component lives under the description. */}
          <col style={{ width: 168 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Unit price</th>
            {showCost && <th className="num">Unit cost</th>}
            {showCost && <th className="num">Markup</th>}
            <th className="num">Amount</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {/* Ungrouped lines lead: on a quote with no sections that is every line, and on one
              with sections they are the work that sits above the first heading.
              OPTIONAL lines are not here — they are gathered at the foot, below. */}
          {lines.map((line, i) =>
            line.parentIndex == null && line.sectionIndex == null && !line.opt
              ? renderRow(line, i)
              : null,
          )}
          {sections.map((name, at) => (
            <Fragment key={`section-${at}`}>
              <tr className="sectionrow">
                <td>
                  <input
                    value={name}
                    aria-label={`Section name, section ${at + 1}`}
                    onChange={(e) => renameSection(at, e.target.value)}
                  />
                </td>
                <td colSpan={cols - 3} />
                <td className="sectionrow-total">{fmt$(sectionTotal(lines, at))}</td>
                <td className="rowacts">
                  <button
                    className="lineedit-tool"
                    title="Remove this heading — the lines under it stay, ungrouped"
                    aria-label={`Remove section ${at + 1}`}
                    onClick={() => removeSection(at)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
              {lines.map((line, i) =>
                line.parentIndex == null && line.sectionIndex === at && !line.opt
                  ? renderRow(line, i)
                  : null,
              )}
              <tr>
                <td colSpan={cols}>
                  <button
                    type="button"
                    className="linehint"
                    style={{ margin: "var(--space-1) 0 var(--space-1) var(--space-3)" }}
                    onClick={() => addLine(at)}
                  >
                    + Add line to {name || `section ${at + 1}`}
                  </button>
                </td>
              </tr>
            </Fragment>
          ))}
          {/* Upgrade options, gathered at the foot whatever section they were typed in.
              The customer's copy renders add-ons after the work — an editor that shows them
              first, or scattered through the sections, is previewing a different document than
              the one that gets sent. */}
          {optionalIndexes.length > 0 && (
            <>
              <tr className="upgraderow">
                <td colSpan={cols - 1}>Upgrade options</td>
                <td className="sectionrow-total">{fmt$(optionalTotal)}</td>
              </tr>
              {optionalIndexes.map((i) => renderRow(lines[i]!, i))}
            </>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={cols}>
              <div className="lineedit-bar">
                <button type="button" className="lineedit-tool primary" onClick={() => addLine()}>
                  + Line item
                </button>
                {onSections && (
                  <button type="button" className="lineedit-tool" onClick={addSection}>
                    + Section
                  </button>
                )}
                {footerTools}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
