"use client";

/**
 * Line-editor table — the shared quote line grid (description / qty / price /
 * owner cost / amount + per-line chips). Extracted from the composer page so
 * the single-quote body and (later) the GBB tier panels render the same editor.
 *
 * Deferred (intentional no-op — tracked punch-list item):
 *   - "Save to book" chip — needs a store pricebook
 */

import { fmt$ } from "@/lib/format";
import type { ComposerLine } from "./composer-state";

export function LineTable({
  lines,
  showCost,
  onUpdateLine,
  onRemoveLine,
}: {
  lines: ComposerLine[];
  showCost: boolean;
  onUpdateLine: (i: number, patch: Partial<ComposerLine>) => void;
  onRemoveLine: (i: number) => void;
}) {
  return (
    <table className="lineitems">
      <thead>
        <tr>
          <th style={{ width: "44%" }}>Description</th>
          <th>Qty</th>
          <th>Price</th>
          {showCost && <th>Your cost</th>}
          <th style={{ textAlign: "right" }}>Amount</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {lines.map((x, i) => {
          const amt = (x.q ?? 1) * (x.r ?? 0);
          const margin =
            x.c && x.c > 0 && x.r > 0
              ? Math.round((100 * (x.r - x.c)) / x.r)
              : null;
          return (
            <tr key={i}>
              <td>
                <input
                  value={x.d}
                  onChange={(e) =>
                    onUpdateLine(i, { d: e.target.value })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  value={x.q}
                  style={{ width: 60 }}
                  onChange={(e) =>
                    onUpdateLine(i, { q: +e.target.value })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  value={x.r}
                  style={{ width: 84 }}
                  onChange={(e) =>
                    onUpdateLine(i, { r: +e.target.value })
                  }
                />
              </td>
              {showCost && (
                <td>
                  <input
                    type="number"
                    value={x.c ?? ""}
                    placeholder="—"
                    title="What you paid (owner-only) — set it and we suggest a price at your markup; margin shows itself."
                    style={{ width: 78 }}
                    onChange={(e) =>
                      onUpdateLine(i, { c: +e.target.value || undefined })
                    }
                  />
                </td>
              )}
              <td style={{ textAlign: "right", fontWeight: 700 }}>
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
              <td style={{ whiteSpace: "normal" }}>
                {x.d && x.d.trim() && (
                  <>
                    <button
                      className={`optchip${x.opt ? " on" : ""}`}
                      title="Optional add-on — the customer can add or skip this on their quote page"
                      onClick={() => onUpdateLine(i, { opt: !x.opt })}
                    >
                      {x.opt ? "✓ Optional" : "Make optional"}
                    </button>{" "}
                    <button
                      className="btn sm ghost"
                      title="Attach a photo the customer sees beside this line"
                      onClick={() => onUpdateLine(i, { photo: !x.photo })}
                    >
                      {x.photo ? "✓ Photo" : "+ Photo"}
                    </button>{" "}
                    <button
                      className="btn sm ghost"
                      title="Save this line to your pricebook so you can reuse it"
                      onClick={() => {
                        // deferred: needs a store pricebook — no-op for now
                      }}
                    >
                      Save to book
                    </button>{" "}
                  </>
                )}
                <button
                  className="btn sm ghost"
                  title="Remove this line"
                  onClick={() => onRemoveLine(i)}
                >
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
