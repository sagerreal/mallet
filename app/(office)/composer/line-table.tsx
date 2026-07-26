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
 * Row actions are deliberately minimal: Optional (customer-facing choice) and
 * remove. Save-to-book died when the estimator's learning loop took over
 * feeding the pricebook; the Photo chip returns when it attaches real photos.
 */

import { fmt$ } from "@/lib/format";
import type { ComposerLine } from "./composer-state";

export function LineTable({
  lines,
  showCost,
  onUpdateLine,
  onRemoveLine,
  onAddLine,
  footerTools,
  materialize,
  provenanceFor,
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
}) {
  const cols = showCost ? 6 : 5;

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
              <tr key={i}>
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
                </td>
                <td>
                  <input
                    type="number"
                    className="num"
                    value={x.q}
                    aria-label={`Quantity, line ${i + 1}`}
                    onChange={(e) => onUpdateLine(i, { q: +e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="num"
                    value={x.r}
                    aria-label={`Price, line ${i + 1}`}
                    onChange={(e) => onUpdateLine(i, { r: +e.target.value })}
                  />
                </td>
                {showCost && (
                  <td>
                    <input
                      type="number"
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
                <td className={`amt${amt === 0 ? " zero" : ""}`}>
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
                    </>
                  )}
                  {(hasContent || lines.length > 1) && (
                    <button
                      className="lineedit-tool"
                      title="Remove this line"
                      aria-label="Remove this line"
                      onClick={() => onRemoveLine(i)}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
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
