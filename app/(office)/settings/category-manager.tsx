"use client";

/**
 * Pricebook → Categories editor (BARE — no toggle chrome). Lists existing
 * categories and a small add affordance; categories populate the per-row
 * picker in ServiceRow. The caller provides the disclosure (the Defaults
 * rail's DisclosureRow) — this renders only the body. No archive/remove yet —
 * the store has no archiveCategory action (YAGNI for Phase 1).
 */

import { useState } from "react";
import type { Category } from "@/lib/store/types";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";

export interface CategoryManagerProps {
  categories: Category[];
  onAdd: (name: string) => Promise<AddResult>;
}

export function CategoryManager({ categories, onAdd }: CategoryManagerProps) {
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
    <div>
      {categories.map((c) => (
        <div key={c.id} className="stage-row" style={{ padding: "var(--space-2) 0" }}>
          <span style={{ flex: 1 }}>{c.name}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: categories.length ? "var(--space-2)" : "0" }}>
        <input
          type="text"
          placeholder="e.g. Water Heaters"
          value={name}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          className="field-compact"
          style={{ flex: 1 }}
        />
        <button className="btn sm" onClick={() => void handleAdd()}>+ Add</button>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>}
    </div>
  );
}
