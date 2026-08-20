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
 * Accessibility: every cell input carries an explicit aria-label naming its column and row
 * ("Quantity, line 2"). The <th> column headers do NOT name these inputs — a screen reader
 * announcing a bare spinbutton is what axe's `label` rule flags, and it went unnoticed while an
 * empty composer hid this table behind a hero.
 *
 * Row actions are deliberately minimal: Optional (customer-facing choice), No tax (only once
 * the quote carries a rate — with no rate nothing is taxed and the chip would decide nothing),
 * and remove. Save-to-book died when the estimator's learning loop took over feeding the
 * pricebook; the Photo chip returns when it attaches real photos.
 */

import { Fragment, useState } from "react";
import { fmt$ } from "@/lib/format";
import { realSubItems, withSubPatch, type ComposerLine } from "./composer-state";
import { ScopeEditor, SubItemEditor } from "./line-depth";

export function LineTable({
  lines,
  showCost,
  onUpdateLine,
  onRemoveLine,
  onAddLine,
  footerTools,
  materialize,
  provenanceFor,
  taxed = false,
  priceMode = "lines",
}: {
  lines: ComposerLine[];
  showCost: boolean;
  onUpdateLine: (i: number, patch: Partial<ComposerLine>) => void;
  onRemoveLine: (i: number) => void;
  /** Renders "+ Add line" first in the footer toolbar. */
  onAddLine?: () => void;
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
  const cols = showCost ? 6 : 5;
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
  const dropIndex = (set: ReadonlySet<number>, removed: number): ReadonlySet<number> => {
    const next = new Set<number>();
    for (const n of set) {
      if (n === removed) continue;
      next.add(n > removed ? n - 1 : n);
    }
    return next;
  };
  const handleRemoveLine = (i: number) => {
    setScopeOpen(dropIndex(scopeOpen, i));
    setSubOpen(dropIndex(subOpen, i));
    onRemoveLine(i);
  };

  return (
    <div className={`lineedit${materialize ? " materialize" : ""}`}>
      <table>
        <colgroup>
          <col />
          <col style={{ width: 68 }} />
          <col style={{ width: 96 }} />
          {showCost && <col style={{ width: 96 }} />}
          <col style={{ width: 104 }} />
          {/* Actions hold just Optional + ✕ now — sized to fit, so AMOUNT no
              longer floats beside a wide dead zone. */}
          <col style={{ width: 122 }} />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            {showCost && <th className="num">Your cost</th>}
            <th className="num">Amount</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((x, i) => {
            const amt = (x.q ?? 1) * (x.r ?? 0);
            const margin =
              x.c && x.c > 0 && x.r > 0
                ? Math.round((100 * (x.r - x.c)) / x.r)
                : null;
            const hasContent = Boolean(x.d && x.d.trim());
            return (
              <Fragment key={i}>
              <tr>
                <td>
                  <input
                    value={x.d}
                    placeholder="Describe the work…"
                    aria-label={`Description, line ${i + 1}`}
                    onChange={(e) => onUpdateLine(i, { d: e.target.value })}
                  />
                  {(() => {
                    const src = hasContent ? provenanceFor?.(x.d) : null;
                    return src ? <span className="line-prov">{src}</span> : null;
                  })()}
                  {hasContent && (
                    <div className="linehints">
                      <button
                        type="button"
                        className="linehint"
                        aria-expanded={scopeOpen.has(i)}
                        aria-controls={`line-scope-${i}`}
                        title="Scope prose the customer reads under this line — Includes, Excludes, Products"
                        onClick={() => setScopeOpen(toggle(scopeOpen, i))}
                      >
                        {x.scope?.trim() ? "¶ Scope" : "¶ Add scope"}
                      </button>
                      <button
                        type="button"
                        className="linehint"
                        aria-expanded={subOpen.has(i)}
                        aria-controls={`line-sub-${i}`}
                        title="Your estimate math — rolls up into this line's price, never shown to the customer"
                        onClick={() => setSubOpen(toggle(subOpen, i))}
                      >
                        {realSubItems(x.sub).length > 0
                          ? `↳ Sub-items (${realSubItems(x.sub).length})`
                          : "↳ Add sub-items"}
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="num"
                    value={x.q}
                    aria-label={`Quantity, line ${i + 1}`}
                    onChange={(e) => onUpdateLine(i, { q: +e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="num"
                    value={x.r}
                    aria-label={
                      realSubItems(x.sub).length > 0
                        ? `Price, line ${i + 1} — set by its sub-items below`
                        : `Price, line ${i + 1}`
                    }
                    disabled={realSubItems(x.sub).length > 0}
                    title={
                      realSubItems(x.sub).length > 0
                        ? "Priced by its sub-items — edit them below"
                        : undefined
                    }
                    onChange={(e) => onUpdateLine(i, { r: +e.target.value })}
                  />
                </td>
                {showCost && (
                  <td>
                    <input
                      type="number"
                      inputMode="decimal"
                      className="num"
                      value={x.c ?? ""}
                      placeholder="—"
                      aria-label={`Your cost, line ${i + 1}`}
                      title="What you paid (owner-only) — margin shows itself."
                      onChange={(e) =>
                        onUpdateLine(i, { c: +e.target.value || undefined })
                      }
                    />
                  </td>
                )}
                <td className={`amt${amt === 0 ? " zero" : ""}${priceMode === "total" ? " customer-hidden" : ""}`}>
                  {fmt$(amt)}
                  {showCost && margin !== null && (
                    <div
                      className="muted"
                      style={{ fontWeight: 500, fontSize: "var(--type-xs)" }}
                    >
                      {margin}% margin
                    </div>
                  )}
                </td>
                <td className="rowacts">
                  {hasContent && (
                    <>
                      <button
                        className={`optchip${x.opt ? " on" : ""}`}
                        title="Optional add-on — the customer can add or skip this on their quote page"
                        onClick={() => onUpdateLine(i, { opt: !x.opt })}
                      >
                        {x.opt ? "✓ Optional" : "Optional"}
                      </button>{" "}
                      {taxed && (
                        <>
                          <button
                            className={`optchip${x.notax ? " on" : ""}`}
                            title="Not taxable — the shop's sales-tax rate is not charged on this line. It is still billed in full."
                            aria-pressed={Boolean(x.notax)}
                            onClick={() => onUpdateLine(i, { notax: !x.notax })}
                          >
                            {x.notax ? "✓ No tax" : "No tax"}
                          </button>{" "}
                        </>
                      )}
                    </>
                  )}
                  {(hasContent || lines.length > 1) && (
                    <button
                      className="lineedit-tool"
                      title="Remove this line"
                      aria-label="Remove this line"
                      onClick={() => handleRemoveLine(i)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
              {hasContent && scopeOpen.has(i) && (
                <tr className="linedetail">
                  <td colSpan={cols} id={`line-scope-${i}`}>
                    <ScopeEditor
                      value={x.scope ?? ""}
                      lineNo={i + 1}
                      onChange={(scope) => onUpdateLine(i, { scope: scope || undefined })}
                    />
                  </td>
                </tr>
              )}
              {hasContent && subOpen.has(i) && (
                <tr className="linedetail">
                  <td colSpan={cols} id={`line-sub-${i}`}>
                    <SubItemEditor
                      sub={x.sub ?? []}
                      lineNo={i + 1}
                      onChange={(sub) => {
                        const next = withSubPatch(x, sub);
                        onUpdateLine(i, { sub: next.sub, r: next.r });
                      }}
                    />
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
        {(onAddLine || footerTools) && (
          <tfoot>
            <tr>
              <td colSpan={cols}>
                <div className="lineedit-bar">
                  {onAddLine && (
                    <button
                      type="button"
                      className="lineedit-tool primary"
                      onClick={onAddLine}
                    >
                      + Add line
                    </button>
                  )}
                  {footerTools}
                </div>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
