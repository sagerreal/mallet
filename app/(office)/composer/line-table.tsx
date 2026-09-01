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

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { realSubItems, withSubPatch, type ComposerLine } from "./composer-state";
import { ScopeEditor, SubItemEditor } from "./line-depth";
import { LineRow } from "./line-row";
import { LineInspector } from "./line-inspector";
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
  // Column count follows the view: pricing = description, qty, unit price, amount, actions;
  // costing adds unit, unit cost and markup.
  const cols = showCost ? 8 : 5;
  // GBB renders three LineTables at once — panel ids must be unique per instance or every
  // tier's aria-controls points at whichever twin rendered first.
  const uid = useId();
  // Which lines have their depth editors open. Presence of DATA lives on the line itself;
  // these sets are only the expand/collapse UI state, so they reset harmlessly on unmount.
  const [scopeOpen, setScopeOpen] = useState<ReadonlySet<number>>(new Set());
  /**
   * The selected line — what the inspector rail shows. Selection is UI state, index-keyed like
   * the depth sets, so every structural change below remaps or clears it. Null = no rail, and
   * the ledger takes the full width (the mock's c1-no-selection).
   */
  const [selected, setSelected] = useState<number | null>(null);
  /** The rail folded to its seam — the mock's "Details ›" pull tab. */
  const [railFolded, setRailFolded] = useState(false);
  /** Collapsed assemblies: the parent row stays, its component rows hide behind a subline. */
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [subOpen, setSubOpen] = useState<ReadonlySet<number>>(new Set());
  /** The footer's "More ▾" menu. Closes on an outside press, like any menu. */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [moreOpen]);
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
    setCollapsed(dropIndexes(collapsed, removed));
    // Selection follows the same remap: gone with its row, shifted past the hole otherwise —
    // a stale index would dock the WRONG line's details in the rail.
    setSelected((cur) => {
      if (cur === null || removed.has(cur)) return null;
      return cur - [...removed].filter((r) => r < cur).length;
    });
    commit(removeLineAt(lines, i));
  };

  const addComponentTo = (parentIndex: number) => {
    const existing = componentIndexes(lines, parentIndex);
    const at = (existing[existing.length - 1] ?? parentIndex) + 1;
    setScopeOpen(shiftIndexes(scopeOpen, at));
    setSubOpen(shiftIndexes(subOpen, at));
    setCollapsed(shiftIndexes(collapsed, at));
    setSelected((cur) => (cur !== null && cur >= at ? cur + 1 : cur));
    commit(addComponent(lines, parentIndex, { d: "", q: 1, r: 0, qtyExpr: "qty" }));
  };

  /** Copy a line after its block — an assembly comes with its parts, indexes remapped. */
  const duplicateLine = (i: number) => {
    const parts = componentIndexes(lines, i);
    const after = (parts[parts.length - 1] ?? i) + 1;
    const copies: ComposerLine[] = [
      { ...lines[i]! },
      ...parts.map((at) => ({ ...lines[at]!, parentIndex: after })),
    ];
    const next = [...lines.slice(0, after), ...copies, ...lines.slice(after)].map((l, idx) => {
      // Lines BELOW the insertion keep pointing at their own parents, which just moved down.
      if (idx > after + parts.length && l.parentIndex != null && l.parentIndex >= after) {
        return { ...l, parentIndex: l.parentIndex + copies.length };
      }
      return l;
    });
    setScopeOpen(new Set<number>());
    setSubOpen(new Set<number>());
    setCollapsed(new Set<number>());
    setSelected(after);
    commit(next);
  };

  /**
   * The order a line steps through — its GROUP, the mock's semantics: a component moves within
   * its parent, an optional line within the optional band, and a top-level line moves as a
   * BLOCK (its parts travel with it) within its own section's render order.
   */
  const moveGroup = (i: number): number[] => {
    const line = lines[i]!;
    if (line.parentIndex != null) return componentIndexes(lines, line.parentIndex);
    if (line.opt) return optionalIndexes;
    return lines.reduce<number[]>((found, l, at) => {
      if (l.parentIndex == null && !l.opt && (l.sectionIndex ?? null) === (line.sectionIndex ?? null)) {
        found.push(at);
      }
      return found;
    }, []);
  };

  const canMove = (i: number, dir: -1 | 1): boolean => {
    const group = moveGroup(i);
    const at = group.indexOf(i);
    return dir === -1 ? at > 0 : at >= 0 && at < group.length - 1;
  };

  /** Swap two BLOCKS (line + its components) and remap every parentIndex + open-set. */
  const moveLine = (i: number, dir: -1 | 1) => {
    const group = moveGroup(i);
    const at = group.indexOf(i);
    const j = group[at + dir];
    if (j === undefined) return;
    const blockOf = (head: number) => [head, ...componentIndexes(lines, head)];
    const a = blockOf(Math.min(i, j));
    const b = blockOf(Math.max(i, j));
    // Only adjacent-block swaps are safe by construction here: between a and b there may be
    // OTHER blocks (other sections' lines render elsewhere but live between them in the
    // array). Rebuild the array by order, swapping just the two blocks' positions.
    // Rebuild by array order with just the two blocks' positions swapped: at the first index
    // either block occupies, emit b-then-a (a is the earlier block, so this is always a swap).
    // Rows interleaved between them (other sections') keep their own relative order — the
    // render groups by section, so their array position is not their screen position.
    const order = lines.map((_, idx) => idx);
    const next: number[] = [];
    let placed = false;
    for (const idx of order) {
      if (a.includes(idx) || b.includes(idx)) {
        if (!placed) {
          next.push(...b, ...a);
          placed = true;
        }
        continue;
      }
      next.push(idx);
    }
    const remap = new Map(next.map((oldIdx, newIdx) => [oldIdx, newIdx]));
    const rebuilt = next.map((oldIdx) => {
      const l = lines[oldIdx]!;
      return l.parentIndex != null ? { ...l, parentIndex: remap.get(l.parentIndex)! } : l;
    });
    const remapSet = (set: ReadonlySet<number>) =>
      new Set([...set].map((n) => remap.get(n)).filter((n): n is number => n !== undefined));
    setScopeOpen(remapSet(scopeOpen));
    setSubOpen(remapSet(subOpen));
    setCollapsed(remapSet(collapsed));
    setSelected((cur) => (cur === null ? null : (remap.get(cur) ?? null)));
    commit(rebuilt);
  };

  const addLine = (sectionIndex?: number) => {
    // The mock selects what it just made — the new line's details dock immediately, so the
    // rail is never a hidden feature you discover by clicking a row.
    setSelected(lines.length);
    setRailFolded(false);
    commit([...lines, sectionIndex == null ? { d: "", q: 1, r: 0 } : { d: "", q: 1, r: 0, sectionIndex }]);
  };

  /**
   * A blank assembly: parent line plus one component counted off its quantity. The mock seeds
   * a cedar-fence example here; the app's no-demo-data rule makes it blank instead. Selecting
   * the parent docks the rail, whose driver-quantity hint teaches the qty-math model.
   */
  const addAssembly = () => {
    const at = lines.length;
    commit(addComponent([...lines, { d: "", q: 1, r: 0 }], at, { d: "", q: 1, r: 0, qtyExpr: "qty" }));
    setSelected(at);
    setRailFolded(false);
  };

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
    const isCollapsed = components.length > 0 && collapsed.has(i);
    return (
      <Fragment key={i}>
        <LineRow
          line={line}
          index={i}
          parent={parent}
          hasComponents={components.length > 0}
          showCost={showCost}
          priceMode={priceMode}
          lastComponent={lastComponent}
          provenanceFor={provenanceFor}
          selected={selected === i}
          onSelect={() => setSelected(i)}
          collapsed={isCollapsed}
          onToggleCollapse={
            components.length > 0
              ? () => setCollapsed((cur) => toggle(cur, i))
              : undefined
          }
          componentCount={components.length}
          onUpdate={(patch) => updateLine(i, patch)}
          onReplace={(next) => replaceLine(i, next)}
          onRemove={() => removeLine(i)}
          onMove={(dir) => moveLine(i, dir)}
          canMoveUp={canMove(i, -1)}
          canMoveDown={canMove(i, 1)}
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
        {/* A collapsed assembly keeps its parts — it just stops showing them. */}
        {!isCollapsed &&
          components.map((at, n) => renderRow(lines[at]!, at, line, n === components.length - 1))}
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

  // The rail column is ALWAYS there once the quote has rows — the mock's model. No selection
  // shows the teaching hint, not a missing panel; the fold works in every state.
  return (
    <div className={`lineedit${materialize ? " materialize" : ""}`}>
      <div className={`lineedit-split railed${railFolded ? " folded" : ""}`}>
      <div className="lineedit-ledger">
      <table>
        <colgroup>
          <col />
          <col style={{ width: 84 }} />
          {/* Unit rides the QUANTITY EDITOR in the rail on the pricing view — the mock's
              pricing grid has no Unit column. It stays a column in the costing view, where
              the whole point is seeing every number at once. */}
          {showCost && <col style={{ width: 56 }} />}
          <col style={{ width: 96 }} />
          {showCost && <col style={{ width: 96 }} />}
          {showCost && <col style={{ width: 72 }} />}
          <col style={{ width: 104 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            {showCost && <th>Unit</th>}
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
                {/* The mock's footer grammar: ONE more button. Several extras gather behind
                    "More ▾"; a lone extra (the GBB tier bars) renders flat — a one-item menu
                    is a longer path to the same button. */}
                {footerTools || onSections ? (
                  <span className="more-wrap" ref={moreRef}>
                    <button
                      type="button"
                      className="lineedit-tool"
                      aria-expanded={moreOpen}
                      aria-controls={`${uid}-more`}
                      onClick={() => setMoreOpen((v) => !v)}
                    >
                      More ▾
                    </button>
                    {moreOpen && (
                      <span
                        className="more-menu"
                        id={`${uid}-more`}
                        onClick={() => setMoreOpen(false)}
                      >
                        {footerTools}
                        {onSections && (
                          <button type="button" className="lineedit-tool" onClick={addSection}>
                            + Section
                          </button>
                        )}
                        <button type="button" className="lineedit-tool" onClick={addAssembly}>
                          + Assembly
                        </button>
                      </span>
                    )}
                  </span>
                ) : (
                  <button type="button" className="lineedit-tool" onClick={addAssembly}>
                    + Assembly
                  </button>
                )}
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
      </div>
      <div className="lineedit-railcol">
        <button
          type="button"
          className="rail-handle"
          aria-expanded={!railFolded}
          aria-label={railFolded ? "Show details" : "Hide details"}
          onClick={() => setRailFolded((v) => !v)}
        >
          <span aria-hidden="true">{railFolded ? "‹" : "›"}</span>
          <span className="vtext">Details</span>
        </button>
        {railFolded ? (
          <button
            type="button"
            className="rail-unfold"
            aria-label="Show details"
            onClick={() => setRailFolded(false)}
          />
        ) : selected === null ? (
          <div className="rail rail-empty">
            Select a line item to edit its pricing, cost, scope, and customer settings.
          </div>
        ) : (
          <LineInspector
            lines={lines}
            selected={selected}
            sections={sections}
            taxed={taxed}
            onUpdate={updateLine}
            onReplace={replaceLine}
            onSelect={setSelected}
            onRemove={removeLine}
            onAddComponent={addComponentTo}
            onDuplicate={duplicateLine}
          />
        )}
      </div>
      </div>
    </div>
  );
}
