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
  priceMode: "lines" | "total";
  /** True for the last component under a parent — closes the group with a rule. */
  lastComponent?: boolean;
  provenanceFor?: (description: string) => "pricebook" | null;
  /** This row is docked in the inspector rail. */
  selected?: boolean;
  /** Clicking anywhere on the row selects it — inputs included; selection never eats the edit. */
  onSelect?: () => void;
  /** An assembly folded to its subline. */
  collapsed?: boolean;
  /** Present only on assembly parents — the ± disclosure. */
  onToggleCollapse?: () => void;
  componentCount?: number;
  onUpdate: (patch: Partial<ComposerLine>) => void;
  /** Replaces the whole line — for the edits that must ADD or REMOVE a key, not set one. */
  onReplace: (next: ComposerLine) => void;
  onRemove: () => void;
  /** Step this line within its group — a component within its parent, an optional within the
   *  optional band, a top-level block (with its parts) within its section. Absent = ends. */
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** The depth toggles the table owns (scope prose, legacy sub-items). */
  hints?: React.ReactNode;
}

export function LineRow({
  line,
  index,
  parent,
  hasComponents,
  showCost,
  priceMode,
  lastComponent,
  provenanceFor,
  selected,
  onSelect,
  collapsed,
  onToggleCollapse,
  componentCount = 0,
  onUpdate,
  onReplace,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  hints,
}: LineRowProps) {
  const isComponent = Boolean(parent);
  const resolved = resolveQuantity(line, parent);
  const quantity = resolved.value;
  const quantityValid = resolved.valid;
  const amount = quantity * (line.r ?? 0);
  const margin =
    line.c != null && line.c > 0 && line.r > 0 ? Math.round((100 * (line.r - line.c)) / line.r) : null;
  const hasContent = Boolean(line.d && line.d.trim());
  const lineNo = index + 1;
  // A line priced by its parts does not take a typed price. Sub-items did this before
  // components existed and old quotes still carry them, so both lock the field.
  const pricedByParts = hasComponents || realSubItems(line.sub).length > 0;

  const rowClass = [
    isComponent ? `component${lastComponent ? " component-last" : ""}` : "",
    selected ? "rowsel" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr className={rowClass || undefined} onClick={onSelect}>
      {showCost && (
        <td>
          <select
            className="type-select"
            value={line.ltype ?? ""}
            aria-label={`Item type, line ${lineNo}`}
            onChange={(e) =>
              onUpdate({ ltype: (e.target.value || undefined) as ComposerLine["ltype"] })
            }
          >
            <option value="">—</option>
            <option value="material">Material</option>
            <option value="labor">Labor</option>
            <option value="equipment">Equipment</option>
            <option value="subcontract">Subcontract</option>
            <option value="other">Other</option>
          </select>
        </td>
      )}
      <td>
        <div className="desc-cell">
          {onToggleCollapse && (
            <button
              type="button"
              className="asm-disc"
              aria-expanded={!collapsed}
              aria-label={collapsed ? `Expand assembly, line ${lineNo}` : `Collapse assembly, line ${lineNo}`}
              onClick={(e) => {
                // The disclosure folds the assembly; it must not ALSO change the selection.
                e.stopPropagation();
                onToggleCollapse();
              }}
            >
              {collapsed ? "+" : "−"}
            </button>
          )}
          <input
            value={line.d}
            placeholder={isComponent ? "Describe the cost item…" : "Describe the work…"}
            aria-label={isComponent ? `Description, component ${lineNo}` : `Description, line ${lineNo}`}
            onChange={(e) => onUpdate({ d: e.target.value })}
          />
        </div>
        {/* Folded, the assembly says what it is holding — the mock's subline. */}
        {collapsed && (
          <span className="asm-sub">
            Assembly · {componentCount} item{componentCount === 1 ? "" : "s"} · {quantity}
            {line.unit ? ` ${line.unit}` : ""}
          </span>
        )}
        {/* The mock's row shows its scope right under the description — the customer-facing
            prose is part of reading the line, not a hidden panel; an invalid quantity states
            itself in the same slot. */}
        {!quantityValid ? (
          <span className="row-scope bad">Check the quantity</span>
        ) : line.scope?.trim() && !collapsed ? (
          <span className="row-scope">{line.scope.trim()}</span>
        ) : null}
        {hasContent && provenanceFor?.(line.d) ? <span className="line-prov">pricebook</span> : null}
        {hints}
      </td>
      <td>
        <QuantityCell line={line} parent={parent} lineNo={lineNo} onChange={onUpdate} />
      </td>
      {showCost && (
        <td>
          <input
            className="unit"
            value={line.unit ?? ""}
            placeholder="—"
            aria-label={`Unit, line ${lineNo}`}
            onChange={(e) => onUpdate({ unit: e.target.value || undefined })}
          />
        </td>
      )}
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
        <td className="amt muted-amt">
          {fmt$((line.q ?? 0) * (line.c ?? 0))}
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
      <td
        className={`amt${amount === 0 ? " zero" : ""}${priceMode === "total" && !isComponent ? " customer-hidden" : ""}`}
      >
        {line.opt ? "+" : ""}
        {fmt$(amount)}
        {showCost && margin !== null && (
          <div className="muted" style={{ fontWeight: 500, fontSize: "var(--type-xs)" }}>
            {margin}% margin
          </div>
        )}
      </td>
      {/* Rows stay quiet like the mock's: remove only. Optional, No tax and Round up moved
          into the inspector rail — three chips per row was a toolbar, and the rail is where
          second-order facts live now. The states still READ from the row: "+" on an optional
          amount, "No tax" never mattered at a glance (the totals corner names the tax), and a
          rounded count simply shows its whole number. */}
      <td className="rowacts">
        {onMove && (
          <>
            <button
              className="lineedit-tool"
              title="Move up"
              aria-label={`Move ${line.d.trim() || (isComponent ? "component" : "line")} up`}
              disabled={!canMoveUp}
              onClick={(e) => {
                e.stopPropagation();
                onMove(-1);
              }}
            >
              ↑
            </button>
            <button
              className="lineedit-tool"
              title="Move down"
              aria-label={`Move ${line.d.trim() || (isComponent ? "component" : "line")} down`}
              disabled={!canMoveDown}
              onClick={(e) => {
                e.stopPropagation();
                onMove(1);
              }}
            >
              ↓
            </button>
          </>
        )}
        <button
          className="lineedit-tool"
          title={isComponent ? "Remove this component" : "Remove this line"}
          aria-label={isComponent ? `Remove component ${lineNo}` : `Remove line ${lineNo}`}
          onClick={(e) => {
            // Removal must not bubble into the row's onSelect — the bubbled select re-docks
            // the removed index, which after the array shrinks is ANOTHER line's rail.
            e.stopPropagation();
            onRemove();
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
