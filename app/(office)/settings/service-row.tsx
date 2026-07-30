"use client";

/**
 * Settings → Pricebook → one service row. Level 0 shows just name → price; clicking
 * the row (▸/▾) reveals the FULL editor IN-FLOW underneath (no floating UI, max two
 * levels): the fields column (category, cost/margin owner-only, labor hours,
 * taxable, warranty, Remove) beside the Parts column (materials, owner-only — cost
 * data). Parts used to hide behind a third-level "Break into parts" reveal; it is
 * now simply a column of the expanded row.
 * "Add Good/Better/Best" (option groups) is Phase 3 — intentionally absent here
 * (no dead buttons for features that don't exist yet).
 */

import { useState } from "react";
import type { Service, Category } from "@/lib/store/types";
import type { MeasuredByKind, ServiceUpdateFields } from "@/lib/store/pricebook-mapper";
import { fmt$ } from "@/lib/format";
import { MaterialManager } from "./material-manager";
import { useFieldId } from "@/components/ui/input";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";

export interface ServiceRowProps {
  service: Service;
  categories: Category[];
  /** Cost/margin are sensitive figures — hidden from tech role, shown to owner/office. */
  canSeeCost: boolean;
  /**
   * Org-level gate for measurement-priced services (painting etc.). Off (the plumbing
   * default) → the editor is byte-identical to pre-Priced-by behavior; on → it gains the
   * "Priced by" row and a unit-labeled price field.
   */
  measurementEstimating: boolean;
  onUpdate: (id: string, fields: ServiceUpdateFields) => void;
  onArchive: (id: string) => void;
}

const fieldInputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

// "" stands in for Flat (measuredBy null) — SelectMenu options are string-valued.
const PRICED_BY_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Flat" },
  { value: "walls_sqft", label: "Walls (per sq ft)" },
  { value: "ceiling_sqft", label: "Ceiling (per sq ft)" },
  { value: "baseboard_lnft", label: "Baseboard (per ln ft)" },
  { value: "crown_lnft", label: "Crown (per ln ft)" },
  { value: "doors_count", label: "Doors (each)" },
  { value: "windows_count", label: "Windows (each)" },
];

/** The price field's label — a flat "$" or a per-unit rate matching the chosen measured kind. */
function priceLabel(measuredBy: string | null): string {
  switch (measuredBy) {
    case "walls_sqft":
    case "ceiling_sqft":
      return "$ per sq ft";
    case "baseboard_lnft":
    case "crown_lnft":
      return "$ per ln ft";
    case "doors_count":
    case "windows_count":
      return "$ each";
    default:
      return "$";
  }
}

function marginPct(service: Service): number {
  if (!service.unitPrice) return 0;
  return Math.round(((service.unitPrice - service.cost) / service.unitPrice) * 100);
}

export function ServiceRow({
  service,
  categories,
  canSeeCost,
  measurementEstimating,
  onUpdate,
  onArchive,
}: ServiceRowProps) {
  const [open, setOpen] = useState(false);
  const categoryField = useFieldId();
  const costField = useFieldId();
  const laborField = useFieldId();
  const pricedByField = useFieldId();
  const priceField = useFieldId();

  return (
    <div style={{ borderBottom: "1px solid var(--line-2)" }}>
      <div
        className="stage-row"
        style={{ borderBottom: "none", cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span style={{ flex: 1, fontWeight: 600 }}>{service.name}</span>
        <span style={{ fontWeight: 700, minWidth: 70, textAlign: "right" }}>{fmt$(service.unitPrice)}</span>
        <span className="caret" style={{ color: "var(--ink-3)" }} aria-hidden="true">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div
          style={{
            padding: "var(--space-1) var(--space-2) var(--space-4)",
            display: "grid",
            // Two columns when Parts shows (owner/office): fields | parts.
            // auto-fit stacks them on narrow screens — still two levels, never three.
            gridTemplateColumns: canSeeCost ? "repeat(auto-fit, minmax(280px, 1fr))" : "1fr",
            gap: "var(--space-3) var(--space-6)",
          }}
        >
        <div style={{ display: "grid", gap: "var(--space-3)", alignContent: "start" }}>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            <label {...categoryField.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Category</label>
            <SelectMenu
              value={service.categoryId ?? ""}
              onChange={(v) => onUpdate(service.id, { categoryId: v || null })}
              options={[{ value: "", label: "— none —" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
              {...categoryField.controlProps}
              compact
            />
          </div>

          {measurementEstimating && (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <label {...pricedByField.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Priced by</label>
              <SelectMenu
                value={service.measuredBy ?? ""}
                onChange={(v) => onUpdate(service.id, { measuredBy: v === "" ? null : (v as MeasuredByKind) })}
                options={PRICED_BY_OPTIONS}
                {...pricedByField.controlProps}
                compact
              />
            </div>
          )}

          {measurementEstimating && (
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <label {...priceField.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>
                {priceLabel(service.measuredBy)}
              </label>
              <input
                {...priceField.controlProps}
                type="number"
                inputMode="decimal"
                min={0}
                defaultValue={service.unitPrice}
                onChange={(e) => onUpdate(service.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                style={{ ...fieldInputStyle, width: 78 }}
              />
            </div>
          )}

          {canSeeCost && (
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
              <label {...costField.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Your cost</label>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <span className="muted">$</span>
                <input
                  {...costField.controlProps}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  defaultValue={service.cost}
                  onChange={(e) => onUpdate(service.id, { cost: Math.max(0, Number(e.target.value) || 0) })}
                  style={{ ...fieldInputStyle, width: 78 }}
                />
              </span>
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                {service.cost > 0 ? `${marginPct(service)}% margin` : "no cost set"}
              </span>
              <span className="muted" style={{ fontSize: "var(--type-xs)" }}>(owner-only)</span>
            </div>
          )}

          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <label {...laborField.labelProps} style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Labor</label>
            <input
              {...laborField.controlProps}
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              defaultValue={service.laborHours ?? ""}
              placeholder="hrs"
              onChange={(e) => {
                const v = e.target.value;
                onUpdate(service.id, { laborHours: v === "" ? null : Math.max(0, Number(v) || 0) });
              }}
              style={{ ...fieldInputStyle, width: 68 }}
            />
            <span className="muted" style={{ fontSize: "var(--type-sm)" }}>hrs</span>
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Taxable</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={service.taxable}
                onChange={(e) => onUpdate(service.id, { taxable: e.target.checked })}
              />
              <i />
            </label>
            <input
              type="text"
              placeholder="Warranty — e.g. 6-yr parts / 1-yr labor"
              defaultValue={service.warrantyText ?? ""}
              onChange={(e) => onUpdate(service.id, { warrantyText: e.target.value.trim() ? e.target.value : null })}
              style={{ ...fieldInputStyle, flex: 1, minWidth: 170 }}
            />
          </div>

          <div>
            <button className="btn sm ghost" onClick={() => onArchive(service.id)}>✕ Remove</button>
          </div>
        </div>

        {/* Parts — a peer column of the expanded editor, not a nested reveal.
            MaterialManager carries its own labeled header. */}
        {canSeeCost && (
          <div style={{ alignSelf: "start" }}>
            <MaterialManager serviceId={service.id} canSeeCost={canSeeCost} />
          </div>
        )}
        </div>
      )}
    </div>
  );
}
