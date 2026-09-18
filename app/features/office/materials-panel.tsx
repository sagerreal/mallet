"use client";

/**
 * features/office/materials-panel.tsx
 * The Materials segment of the pricebook card — sellable parts/equipment (the
 * $1k-cost/$3k-sell AC-unit model). Each row: name · cost → sell (+margin) with a
 * quiet mode marker: rule-priced sell values are derived from the org's markup
 * bands and re-derive when cost changes; typing a price directly flips the item
 * to manual (HCP one-gesture override, done server-side). Lean C-shape register:
 * one searchable list, inline add, no categories.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { Material } from "@/lib/store/types";
import { fmt$rate } from "@/lib/format";
import { MarkupBandsEditor } from "@/features/office/markup-bands-editor";
import { DisclosureRow } from "@/components/ui/disclosure-row";

function marginPct(m: Material): number {
  if (!m.unitPrice) return 0;
  return Math.round(((m.unitPrice - m.unitCost) / m.unitPrice) * 100);
}

function MaterialRow({ m, canSeeCost }: { m: Material; canSeeCost: boolean }) {
  const updateMaterial = useAppStore((s) => s.updateMaterial);
  const archiveMaterial = useAppStore((s) => s.archiveMaterial);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderBottom: "1px solid var(--line-2)" }}>
      <div
        className="stage-row"
        style={{ borderBottom: "none", cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
        <span style={{ fontWeight: 700, minWidth: 70, textAlign: "right" }}>
          {fmt$rate(m.unitPrice)}
          {m.pricingMode === "manual" && (
            <span className="muted" style={{ fontWeight: 400, fontSize: "var(--type-sm)" }}> · set by you</span>
          )}
        </span>
        <span className="caret" style={{ color: "var(--ink-3)" }} aria-hidden="true">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="svced">
          <div className="svced-grid">
            <label className="svced-l" htmlFor={`mat-name-${m.id}`}>Name</label>
            <div className="svced-c">
              <input
                id={`mat-name-${m.id}`}
                type="text"
                defaultValue={m.name}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v) updateMaterial(m.id, { name: v });
                }}
                className="svced-in"
              />
            </div>

            {canSeeCost && (
              <>
                <label className="svced-l" htmlFor={`mat-cost-${m.id}`}>Your cost</label>
                <div className="svced-c">
                  <span className="min">
                    <span className="pre">$</span>
                    <input
                      id={`mat-cost-${m.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      defaultValue={m.unitCost}
                      onChange={(e) => updateMaterial(m.id, { unitCost: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </span>
                  <span className="svced-hint">per {m.unitOfMeasure}</span>
                </div>
              </>
            )}

            <label className="svced-l" htmlFor={`mat-price-${m.id}`}>Sell price</label>
            <div className="svced-c">
              <span className="min">
                <span className="pre">$</span>
                <input
                  id={`mat-price-${m.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  // key on the derived value so a rule-mode recompute (cost edit) refreshes
                  // the uncontrolled input — a manual edit flips the mode server-side.
                  key={`${m.pricingMode}-${m.unitPrice}`}
                  defaultValue={m.unitPrice}
                  onChange={(e) => updateMaterial(m.id, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                />
              </span>
              <span className="svced-hint">
                {m.pricingMode === "rule"
                  ? `from your markup table${canSeeCost && m.unitPrice > 0 ? ` · ${marginPct(m)}% margin` : ""}`
                  : `set by you${canSeeCost && m.unitPrice > 0 ? ` · ${marginPct(m)}% margin` : ""}`}
              </span>
            </div>

            <span className="svced-l">Taxable</span>
            <div className="svced-c">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={m.taxable}
                  onChange={(e) => updateMaterial(m.id, { taxable: e.target.checked })}
                  aria-label="Taxable"
                />
                <i />
              </label>
            </div>
          </div>

          <div className="svced-foot">
            <button className="svced-rm" onClick={() => archiveMaterial(m.id)}>
              Remove material
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MaterialsPanel({ canSeeCost }: { canSeeCost: boolean }) {
  const materials = useAppStore((s) => s.materials);
  const addMaterial = useAppStore((s) => s.addMaterial);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newCost, setNewCost] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [bandsOpen, setBandsOpen] = useState(false);

  // THE PACK'S ORDER, not the store's. Services sort here too (sortServices in pricebook-pane);
  // materials never did, so the list came back in whatever order the repo happened to hand over —
  // for the seeded painting book, exactly backwards: sandpaper first, the paint a painter reaches
  // for every day last.
  const active = materials
    .filter((m) => m.active)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const q = query.trim().toLowerCase();
  const visible = q ? active.filter((m) => m.name.toLowerCase().includes(q)) : active;

  /**
   * OPTIMISTIC (the house store pattern): addMaterial inserts the row in the same tick, so the
   * composer clears NOW — clearing on success left the same part in the input AND the list for
   * the whole round trip. A refusal names the reason and restores the typed values (unless the
   * office has already typed the next part — theirs wins).
   */
  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    const cost = newCost;
    setAddError(null);
    setNewName("");
    setNewCost("");
    void addMaterial({ name, unitCost: Math.max(0, Number(cost) || 0) }).then((r) => {
      if (r.ok) return;
      setAddError(r.reason === "duplicate" ? "That material is already in your book." : "Couldn’t add it — check your connection and try again.");
      setNewName((cur) => (cur ? cur : name));
      setNewCost((cur) => (cur ? cur : cost));
    });
  }

  return (
    <>
      {active.length > 0 && (
        <div style={{ padding: "var(--space-3) var(--space-4) var(--space-1)" }}>
          <input
            enterKeyHint="search"
            className="pbsearch"
            type="text"
            placeholder="Search materials…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search materials"
            style={{ width: "100%" }}
          />
        </div>
      )}



      <div style={{ padding: "var(--space-3) var(--space-4)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={newName}
          placeholder="e.g. 3-ton condenser"
          aria-label="New material name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          className="field-compact"
          style={{ flex: 1, minWidth: 160 }}
        />
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
          <span className="muted">cost $</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={newCost}
            placeholder="0"
            aria-label="New material cost"
            onChange={(e) => setNewCost(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            className="field-compact"
            style={{ width: 90 }}
          />
        </span>
        <button className="btn sm" onClick={() => void handleAdd()} disabled={!newName.trim()}>
          + Add
        </button>
      </div>

      <div style={{ padding: "0 var(--space-4)" }}>
        {visible.map((m) => (
          <MaterialRow key={m.id} m={m} canSeeCost={canSeeCost} />
        ))}
        {active.length > 0 && visible.length === 0 && (
          <div className="empty-att">No materials match “{query}”.</div>
        )}
      </div>
      {addError && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", padding: "0 var(--space-4) var(--space-3)", margin: 0 }}>{addError}</p>
      )}

      {/* The markup table lives WITH the things it prices — not in a side rail. */}
      {canSeeCost && (
        <div style={{ padding: "0 var(--space-4) var(--space-3)", borderTop: "1px solid var(--line-2)" }}>
          <DisclosureRow
            label="Markup table"
            value="prices parts from cost"
            open={bandsOpen}
            onToggle={() => setBandsOpen((v) => !v)}
          >
            <MarkupBandsEditor />
          </DisclosureRow>
        </div>
      )}
    </>
  );
}
