"use client";

/**
 * Settings → Pricebook → service row → MaterialManager → one attached-part row.
 * Extracted out of material-manager.tsx to keep that file under its line budget:
 * name · editable qty (re-attaches on blur) · unit cost · line cost · remove.
 */

import { fmt$2 } from "@/lib/format";
import type { Material } from "@/lib/store/types";

const qtyInputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
  width: 56,
  textAlign: "right",
};

export interface PartRowProps {
  material: Material;
  quantity: number;
  onQuantityChange: (materialId: string, quantity: number) => void;
  onRemove: (materialId: string) => void;
}

export function PartRow({ material, quantity, onQuantityChange, onRemove }: PartRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ flex: 1 }}>{material.name}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0.01}
        step={0.01}
        defaultValue={quantity}
        onBlur={(e) => onQuantityChange(material.id, Number(e.target.value) || 0)}
        style={qtyInputStyle}
        aria-label={`${material.name} quantity`}
      />
      <span className="muted" style={{ minWidth: 78, textAlign: "right" }}>
        × {fmt$2(material.unitCost)}/{material.unitOfMeasure}
      </span>
      <span style={{ minWidth: 64, textAlign: "right", fontWeight: 600 }}>
        {fmt$2(material.unitCost * quantity)}
      </span>
      <button
        className="btn sm ghost"
        onClick={() => onRemove(material.id)}
        aria-label={`Remove ${material.name}`}
      >
        ✕
      </button>
    </div>
  );
}
