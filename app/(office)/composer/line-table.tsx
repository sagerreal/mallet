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
 * "Save to book" persists the line into the real pricebook via onSaveToBook —
 * per-row status (saved / duplicate / failed) renders inline, no silent no-op.
 */

import { useState } from "react";
import { fmt$ } from "@/lib/format";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";
import type { ComposerLine } from "./composer-state";

type SaveStatus = "saving" | AddResult;

/** Inline copy for a line's save-to-book status — null while there's nothing to show. */
function saveStatusLabel(status: SaveStatus | undefined): string | null {
  if (!status || status === "saving") return null;
  if (status.ok) return "Saved to pricebook";
  if (status.reason === "duplicate") return "Already in your pricebook";
  if (status.reason === "empty") return "Add a description first";
  return "Couldn't save — check your connection and try again";
}

export function LineTable({
  lines,
  showCost,
  onUpdateLine,
  onRemoveLine,
  onSaveToBook,
  onAddLine,
  footerTools,
}: {
  lines: ComposerLine[];
  showCost: boolean;
  onUpdateLine: (i: number, patch: Partial<ComposerLine>) => void;
  onRemoveLine: (i: number) => void;
  onSaveToBook: (line: ComposerLine) => Promise<AddResult>;
  /** Renders "+ Add line" first in the footer toolbar. */
  onAddLine?: () => void;
  /** Extra tools for the footer toolbar (uniform .lineedit-tool styling). */
  footerTools?: React.ReactNode;
}) {
  // Per-row save-to-book status, keyed by row index (matches the index-keyed
  // rows below — lines have no stable id of their own).
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({});

  async function handleSaveToBook(i: number, line: ComposerLine) {
    setSaveStatus((s) => ({ ...s, [i]: "saving" }));
    const result = await onSaveToBook(line);
    setSaveStatus((s) => ({ ...s, [i]: result }));
  }

  const cols = showCost ? 6 : 5;

  return (
    <div className="lineedit">
      <table>
        <colgroup>
          <col />
          <col style={{ width: 68 }} />
          <col style={{ width: 96 }} />
          {showCost && <col style={{ width: 96 }} />}
          <col style={{ width: 104 }} />
          <col style={{ width: showCost ? 208 : 196 }} />
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
            const status = saveStatus[i];
            const statusLabel = saveStatusLabel(status);
            const hasContent = Boolean(x.d && x.d.trim());
            return (
              <tr key={i}>
                <td>
                  <input
                    value={x.d}
                    placeholder="Describe the work…"
                    onChange={(e) => onUpdateLine(i, { d: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="num"
                    value={x.q}
                    onChange={(e) => onUpdateLine(i, { q: +e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="num"
                    value={x.r}
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
                      style={{ fontWeight: 500, fontSize: "10.5px" }}
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
                      <button
                        className={`lineedit-tool ${x.photo ? "on" : ""}`}
                        title="Attach a photo the customer sees beside this line"
                        onClick={() => onUpdateLine(i, { photo: !x.photo })}
                      >
                        {x.photo ? "✓ Photo" : "Photo"}
                      </button>{" "}
                      <button
                        className="lineedit-tool"
                        title="Save this line to your pricebook so you can reuse it"
                        disabled={status === "saving"}
                        onClick={() => void handleSaveToBook(i, x)}
                      >
                        {status === "saving" ? "Saving…" : "Book"}
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
                  {statusLabel && (
                    <span className="muted on" style={{ fontSize: 11 }}>
                      {" "}
                      {statusLabel}
                    </span>
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
