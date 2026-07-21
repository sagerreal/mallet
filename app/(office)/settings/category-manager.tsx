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
    <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", fontSize: "var(--type-base)", fontWeight: 700, color: "var(--ink-2)" }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span className="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        Categories ({categories.length})
      </div>
      {open && (
        <div style={{ marginTop: "var(--space-2)" }}>
          {categories.map((c) => (
            <div key={c.id} className="stage-row" style={{ padding: "var(--space-2) 0" }}>
              <span style={{ flex: 1 }}>{c.name}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <input
              type="text"
              placeholder="e.g. Water Heaters"
              value={name}
              onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
              style={{ flex: 1, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)", padding: "var(--space-2) var(--space-2)", fontFamily: "inherit", fontSize: "var(--type-base)" }}
            />
            <button className="btn sm" onClick={() => void handleAdd()}>+ Add category</button>
          </div>
          {error && <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
