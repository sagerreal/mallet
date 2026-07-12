"use client";

/**
 * Settings → Pricebook → inline "Categories" reveal (▸/▾, in-flow, no floating UI).
 * Lists existing categories and a small add-category affordance; categories populate
 * the per-row Level-1 picker in ServiceRow. No archive/remove yet — the store has no
 * archiveCategory action (YAGNI for Phase 1).
 */

import { useState } from "react";
import type { Category } from "@/lib/store/types";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";

export interface CategoryManagerProps {
  categories: Category[];
  onAdd: (name: string) => Promise<AddResult>;
}

export function CategoryManager({ categories, onAdd }: CategoryManagerProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const result = await onAdd(name);
    if (result.ok) {
      setName("");
      setError(null);
    } else if (result.reason === "duplicate") {
      setError("That category already exists.");
    } else if (result.reason === "failed") {
      setError("Couldn’t add that category — check your connection and try again.");
    } else {
      setError(null);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        Categories ({categories.length})
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {categories.map((c) => (
            <div key={c.id} className="stage-row" style={{ padding: "6px 0" }}>
              <span style={{ flex: 1 }}>{c.name}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="e.g. Water Heaters"
              value={name}
              onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
              style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: 8, padding: "7px 9px", fontFamily: "inherit", fontSize: 13 }}
            />
            <button className="btn sm" onClick={() => void handleAdd()}>+ Add category</button>
          </div>
          {error && <p style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
