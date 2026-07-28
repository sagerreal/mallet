"use client";

/**
 * Settings → Pricebook → the "+ Add" row (name + price) with inline error feedback,
 * mirroring the addSource pattern in SecSources (settings/page.tsx).
 */

import { useState } from "react";
import type { AddServiceFields } from "@/lib/store/pricebook-mapper";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";

export interface AddServiceRowProps {
  onAdd: (fields: AddServiceFields) => Promise<AddResult>;
  /** Focus the name input on mount — the first-run "Build your own" landing. */
  autoFocus?: boolean;
}

const inputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-3)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

export function AddServiceRow({ onAdd, autoFocus = false }: AddServiceRowProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const result = await onAdd({ name, unitPrice: Number(price) || 0 });
    if (result.ok) {
      setName("");
      setPrice("");
      setError(null);
    } else if (result.reason === "duplicate") {
      setError("That service is already in your pricebook.");
    } else if (result.reason === "failed") {
      setError("Couldn’t add that service — check your connection and try again.");
    } else {
      setError(null); // empty input — no-op, no error needed
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <input
          type="text"
          placeholder="e.g. Hydro-jet kitchen drain"
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          style={{ ...inputStyle, flex: 2 }}
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="price $"
          value={price}
          onChange={(e) => { setPrice(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          style={{ ...inputStyle, flex: "0 0 100px" }}
        />
        <button className="btn" onClick={() => void handleAdd()}>+ Add</button>
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>}
    </div>
  );
}
