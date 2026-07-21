"use client";

/**
 * Settings → Pricebook → one service row. Level 0 shows just name → price; clicking
 * the row (▸/▾) reveals its details IN-FLOW underneath (no floating UI): category,
 * cost/margin (owner-only), labor hours, taxable, warranty, a "Break into parts"
 * materials reveal (owner-only — cost data), and a Remove action.
 * "Add Good/Better/Best" (option groups) is Phase 3 — intentionally absent here
 * (no dead buttons for features that don't exist yet).
 */

import { useState } from "react";
import type { Service, Category } from "@/lib/store/types";
import type { ServiceUpdateFields } from "@/lib/store/pricebook-mapper";
import { fmt$ } from "@/lib/format";
import { MaterialManager } from "./material-manager";

export interface ServiceRowProps {
  service: Service;
  categories: Category[];
  /** Cost/margin are sensitive figures — hidden from tech role, shown to owner/office. */
  canSeeCost: boolean;
  onUpdate: (id: string, fields: ServiceUpdateFields) => void;
  onArchive: (id: string) => void;
}

const fieldInputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

function marginPct(service: Service): number {
  if (!service.unitPrice) return 0;
  return Math.round(((service.unitPrice - service.cost) / service.unitPrice) * 100);
}

export function ServiceRow({ service, categories, canSeeCost, onUpdate, onArchive }: ServiceRowProps) {
  const [open, setOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);

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
        <div style={{ padding: "4px 6px 14px", display: "grid", gap: 11 }}>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Category</label>
            <select
              className="tsel"
              value={service.categoryId ?? ""}
              onChange={(e) => onUpdate(service.id, { categoryId: e.target.value || null })}
            >
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {canSeeCost && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Your cost</label>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span className="muted">$</span>
                <input
                  type="number"
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
            <label style={{ fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", minWidth: 66 }}>Labor</label>
            <input
              type="number"
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

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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

          {canSeeCost && (
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <button
                className="btn sm ghost"
                style={{ justifySelf: "start" }}
                onClick={() => setPartsOpen((v) => !v)}
                aria-expanded={partsOpen}
              >
                {partsOpen ? "▾" : "▸"} Break into parts
              </button>
              {partsOpen && <MaterialManager serviceId={service.id} canSeeCost={canSeeCost} />}
            </div>
          )}

          <div>
            <button className="btn sm ghost" onClick={() => onArchive(service.id)}>✕ Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
