"use client";

/**
 * One row of the line editor — a quoted line, or a component of the assembly above it.
 *
 * Split out of line-table.tsx, which owns the table shell and the array arithmetic. A row knows
 * only about itself and, when it is a component, the parent whose quantity it counts off.
 */

import { fmt$, fmt$rate } from "@/lib/format";
import { realSubItems, type ComposerLine } from "./composer-state";
import { QuantityCell } from "./quantity-cell";
import {
  resolveQuantity,
  isPricedFromCost,
  impliedMarkupBps,
  withMarkup,
  repriceFromCost,
  withTypedRate,
} from "./line-math";

export interface LineRowProps {
  line: ComposerLine;
  /** Index in the whole line array — what every callback is keyed by. */
  index: number;
  /** The line this is a component of. Absent on a quoted line. */
  parent?: ComposerLine;
  /** Does this line have components. Its price is then rolled up, not typed. */
  hasComponents: boolean;
  showCost: boolean;
  taxed: boolean;
  priceMode: "lines" | "total";
  /** True for the last component under a parent — closes the group with a rule. */
  lastComponent?: boolean;
  provenanceFor?: (description: string) => "pricebook" | null;
  onUpdate: (patch: Partial<ComposerLine>) => void;
  /** Replaces the whole line — for the edits that must ADD or REMOVE a key, not set one. */
  onReplace: (next: ComposerLine) => void;
  onRemove: () => void;
  /** The depth toggles the table owns (scope prose, legacy sub-items). */
  hints?: React.ReactNode;
}

export function LineRow({
  line,
  index,
  parent,
  hasComponents,
  showCost,
  taxed,
  priceMode,
  lastComponent,
  provenanceFor,
  onUpdate,
  onReplace,
  onRemove,
  hints,
}: LineRowProps) {
  const isComponent = Boolean(parent);
  const quantity = resolveQuantity(line, parent).value;
  const amount = quantity * (line.r ?? 0);
  const margin =
    line.c != null && line.c > 0 && line.r > 0 ? Math.round((100 * (line.r - line.c)) / line.r) : null;
  const hasContent = Boolean(line.d && line.d.trim());
  const lineNo = index + 1;
  // A line priced by its parts does not take a typed price. Sub-items did this before
  // components existed and old quotes still carry them, so both lock the field.
  const pricedByParts = hasComponents || realSubItems(line.sub).length > 0;

  return (
    <tr className={isComponent ? `component${lastComponent ? " component-last" : ""}` : undefined}>
      <td>
        <input
          value={line.d}
          placeholder={isComponent ? "Describe the cost item…" : "Describe the work…"}
          aria-label={isComponent ? `Description, component ${lineNo}` : `Description, line ${lineNo}`}
          onChange={(e) => onUpdate({ d: e.target.value })}
        />
        {hasContent && provenanceFor?.(line.d) ? <span className="line-prov">pricebook</span> : null}
        {hints}
      </td>
      <td>
        <QuantityCell line={line} parent={parent} lineNo={lineNo} onChange={onUpdate} />
      </td>
      <td>
        <input
          className="unit"
          value={line.unit ?? ""}
          placeholder="—"
          aria-label={`Unit, line ${lineNo}`}
          onChange={(e) => onUpdate({ unit: e.target.value || undefined })}
        />
      </td>
      <td>
        {pricedByParts ? (
          <span className="rolled" aria-label={`Price, line ${lineNo} — set by its components`}>
            {fmt$rate(line.r ?? 0)}
          </span>
        ) : (
          <input
            type="number"
            inputMode="decimal"
            className="num"
            value={line.r}
            aria-label={`Price, line ${lineNo}`}
            title={
              isPricedFromCost(line)
                ? "Priced from cost — typing a price here makes it yours and drops the markup"
                : undefined
            }
            onChange={(e) => onReplace(withTypedRate(line, +e.target.value))}
          />
        )}
      </td>
      {showCost && (
        <td>
          {hasComponents ? (
            <span className="rolled" aria-label={`Your cost, line ${lineNo} — set by its components`}>
              {line.c != null ? fmt$rate(line.c) : "—"}
            </span>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              className="num"
              value={line.c ?? ""}
              placeholder="—"
              aria-label={`Your cost, line ${lineNo}`}
              title="What you paid (owner-only) — margin shows itself."
              onChange={(e) =>
                onReplace(repriceFromCost({ ...line, c: +e.target.value || undefined }))
              }
            />
          )}
        </td>
      )}
      {showCost && (
        <td>
          {hasComponents ? (
            <span className="rolled">—</span>
          ) : (
            <input
              type="number"
              inputMode="decimal"
              className={`num${isPricedFromCost(line) ? " derived" : ""}`}
              value={Math.round(impliedMarkupBps(line) / 100)}
              aria-label={`Markup percent, line ${lineNo}`}
              title="Markup over your cost. Editing it prices this line FROM the cost."
              onChange={(e) => onReplace(withMarkup(line, +e.target.value * 100))}
            />
          )}
        </td>
      )}
      <td
        className={`amt${amount === 0 ? " zero" : ""}${priceMode === "total" && !isComponent ? " customer-hidden" : ""}`}
      >
        {fmt$(amount)}
        {showCost && margin !== null && (
          <div className="muted" style={{ fontWeight: 500, fontSize: "var(--type-xs)" }}>
            {margin}% margin
          </div>
        )}
      </td>
      <td className="rowacts">
        {hasContent && !isComponent && (
          <>
            <button
              className={`optchip${line.opt ? " on" : ""}`}
              title="Optional add-on — the customer can add or skip this on their quote page"
              onClick={() => onUpdate({ opt: !line.opt })}
            >
              {line.opt ? "✓ Optional" : "Optional"}
            </button>{" "}
            {taxed && (
              <>
                <button
                  className={`optchip${line.notax ? " on" : ""}`}
                  title="Not taxable — the shop's sales-tax rate is not charged on this line. It is still billed in full."
                  aria-pressed={Boolean(line.notax)}
                  onClick={() => onUpdate({ notax: !line.notax })}
                >
                  {line.notax ? "✓ No tax" : "No tax"}
                </button>{" "}
              </>
            )}
          </>
        )}
        {isComponent && (
          <button
            className={`optchip${line.roundUp ? " on" : ""}`}
            title="Round the count up to a whole unit — you cannot buy half a post"
            aria-pressed={Boolean(line.roundUp)}
            onClick={() => onUpdate({ roundUp: !line.roundUp })}
          >
            {line.roundUp ? "✓ Round up" : "Round up"}
          </button>
        )}{" "}
        <button
          className="lineedit-tool"
          title={isComponent ? "Remove this component" : "Remove this line"}
          aria-label={isComponent ? `Remove component ${lineNo}` : `Remove line ${lineNo}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
