"use client";

/**
 * Pricebook → one service row. Level 0 shows just name → price; clicking the row
 * (▸/▾) reveals the FULL editor IN-FLOW underneath (no floating UI, max two levels).
 *
 * The editor is one aligned definition grid: Name · (Priced by, measurement orgs
 * only) · Price · Cost, with Labor & tax behind an opt-in reveal. Parts do NOT
 * live inside a service (Owen, Jul 31 2026): the pricebook's two item kinds are
 * flat — Services (line-item templates) and Materials (sellable parts), and a
 * quote pulls from either. The service_material join persists for legacy data
 * but has no editor here. Labor & tax sit in the open grid (HCP shows duration
 * and taxable on the service; a reveal hiding two small fields was ceremony).
 *
 * "Add Good/Better/Best" (option groups) is Phase 3 — intentionally absent here
 * (no dead buttons for features that don't exist yet).
 */

import { useState } from "react";
import type { Service, Category } from "@/lib/store/types";
import type { MeasuredByKind, ServiceUpdateFields } from "@/lib/store/pricebook-mapper";
import { fmt$ } from "@/lib/format";
import { useFieldId } from "@/components/ui/input";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";

export interface ServiceRowProps {
  service: Service;
  categories: Category[];
  /** Cost/margin are sensitive figures — hidden from tech role, shown to owner/office. */
  canSeeCost: boolean;
  /**
   * Org-level gate for measurement-priced services (painting etc.). Off (the plumbing
   * default) → no "Priced by" row; on → the price row gains its per-unit label.
   */
  measurementEstimating: boolean;
  onUpdate: (id: string, fields: ServiceUpdateFields) => void;
  onArchive: (id: string) => void;
}

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

/** The price row's unit suffix — nothing for flat, the measured unit otherwise. */
function priceUnit(measuredBy: string | null): string | null {
  switch (measuredBy) {
    case "walls_sqft":
    case "ceiling_sqft":
      return "per sq ft";
    case "baseboard_lnft":
    case "crown_lnft":
      return "per ln ft";
    case "doors_count":
    case "windows_count":
      return "each";
    default:
      return null;
  }
}

function marginPct(service: Service): number {
  if (!service.unitPrice) return 0;
  return Math.round(((service.unitPrice - service.cost) / service.unitPrice) * 100);
}

/** One aligned label · control row of the editor grid. */
function EditorRow({
  label,
  field,
  children,
}: {
  label: string;
  /** The useFieldId() pair for the row's control. Omit ONLY when the control labels
   * itself (the Taxable switch's aria-label) — the row then renders a span, since a
   * bare <label> with no association fails the label-association net. */
  field?: { labelProps: React.LabelHTMLAttributes<HTMLLabelElement> };
  children: React.ReactNode;
}) {
  return (
    <>
      {field ? (
        <label className="svced-l" {...field.labelProps}>{label}</label>
      ) : (
        <span className="svced-l">{label}</span>
      )}
      <div className="svced-c">{children}</div>
    </>
  );
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
  const nameField = useFieldId();
  const costField = useFieldId();
  const laborField = useFieldId();
  const pricedByField = useFieldId();
  const priceField = useFieldId();
  const unit = priceUnit(service.measuredBy);

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
        <span style={{ fontWeight: 700, minWidth: 70, textAlign: "right" }}>
          {fmt$(service.unitPrice)}
          {unit && <span className="muted" style={{ fontWeight: 400, fontSize: "var(--type-sm)" }}> / {unit.replace("per ", "")}</span>}
        </span>
        <span className="caret" style={{ color: "var(--ink-3)" }} aria-hidden="true">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="svced">
          <div className="svced-grid">
            <EditorRow label="Name" field={nameField}>
              <input
                {...nameField.controlProps}
                type="text"
                defaultValue={service.name}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v) onUpdate(service.id, { name: v });
                }}
                className="svced-in"
              />
            </EditorRow>
            {measurementEstimating && (
              <EditorRow label="Priced by" field={pricedByField}>
                <SelectMenu
                  value={service.measuredBy ?? ""}
                  onChange={(v) => onUpdate(service.id, { measuredBy: v === "" ? null : (v as MeasuredByKind) })}
                  options={PRICED_BY_OPTIONS}
                  {...pricedByField.controlProps}
                  compact
                />
              </EditorRow>
            )}
            <EditorRow label="Price" field={priceField}>
              <span className="svced-money">
                <span className="muted">$</span>
                <input
                  {...priceField.controlProps}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  defaultValue={service.unitPrice}
                  onChange={(e) => onUpdate(service.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                  className="svced-in svced-num"
                />
                {unit && <span className="muted" style={{ fontSize: "var(--type-sm)" }}>{unit}</span>}
              </span>
            </EditorRow>

            {canSeeCost && (
              <>
                <EditorRow label="Your cost" field={costField}>
                  <span className="svced-money">
                    <span className="muted">$</span>
                    <input
                      {...costField.controlProps}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      defaultValue={service.cost}
                      onChange={(e) => onUpdate(service.id, { cost: Math.max(0, Number(e.target.value) || 0) })}
                      className="svced-in svced-num"
                    />
                    <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                      {service.cost > 0 ? `${marginPct(service)}% margin` : "no cost set"} · owner-only
                    </span>
                  </span>
                </EditorRow>
              </>
            )}
            <EditorRow label="Labor" field={laborField}>
              <span className="svced-money">
                <input
                  {...laborField.controlProps}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.25}
                  defaultValue={service.laborHours ?? ""}
                  placeholder="0"
                  onChange={(e) => {
                    const v = e.target.value;
                    onUpdate(service.id, { laborHours: v === "" ? null : Math.max(0, Number(v) || 0) });
                  }}
                  className="svced-in svced-num"
                />
                <span className="muted" style={{ fontSize: "var(--type-sm)" }}>hours</span>
              </span>
            </EditorRow>
            <EditorRow label="Taxable">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={service.taxable}
                  onChange={(e) => onUpdate(service.id, { taxable: e.target.checked })}
                  aria-label="Taxable"
                />
                <i />
              </label>
            </EditorRow>
          </div>

          <div className="svced-foot">
            <button className="btn sm ghost" style={{ color: "var(--red-700, #b91c1c)" }} onClick={() => onArchive(service.id)}>
              Remove service
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
