"use client";

/**
 * Settings → Pricebook → service row → MaterialManager → one attached-part row.
 * Extracted out of material-manager.tsx to keep that file under its line budget:
 * name · editable qty (re-attaches on blur) · unit cost · line cost · remove.
 */

import { fmt$ } from "@/lib/format";
import type { Material } from "@/lib/store/types";

const qtyInputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "inherit",
  fontSize: 13,
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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ flex: 1 }}>{material.name}</span>
      <input
        type="number"
        min={0.01}
        step={0.01}
        defaultValue={quantity}
        onBlur={(e) => onQuantityChange(material.id, Number(e.target.value) || 0)}
        style={qtyInputStyle}
        aria-label={`${material.name} quantity`}
      />
      <span className="muted" style={{ minWidth: 78, textAlign: "right" }}>
        × {fmt$(material.unitCost)}/{material.unitOfMeasure}
      </span>
      <span style={{ minWidth: 64, textAlign: "right", fontWeight: 600 }}>
        {fmt$(material.unitCost * quantity)}
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
