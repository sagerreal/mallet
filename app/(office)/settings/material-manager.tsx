"use client";

/**
 * Settings → Pricebook → service row → the Parts column of the expanded editor
 * (in-flow, anchored in the service row — no floating UI/popovers, no nested
 * reveal). Lists the materials
 * attached to ONE service (name · qty · unit cost · line cost, each removable), the
 * "parts cost $X → price basis" rollup, and an add-part row that either attaches an
 * existing material (searched client-side, results render in-flow under the search
 * input) or creates a new one inline.
 *
 * The rollup is advisory only: it is a simple client-side sum (unitCost × quantity
 * across attached materials, in dollars) shown for the owner's reference — it never
 * writes back to the service's flat price_cents. The flat rate stays the source of
 * truth for what the customer is charged (see the Phase 2a plan's "Markup
 * resolution" section).
 *
 * Materials are cost data, so this component is owner/office-only. It fails closed:
 * even though the caller (ServiceRow) only mounts this behind its own canSeeCost
 * check, this component re-checks and renders nothing for a role that shouldn't see
 * it, in case a future caller forgets the gate.
 */

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { AddMaterialFields } from "@/lib/store/pricebook-mapper";
import { fmt$2 } from "@/lib/format";
import { PartRow } from "./part-row";

export interface MaterialManagerProps {
  serviceId: string;
  /** Cost data — hidden from tech role, shown to owner/office. Fail-closed: see file header. */
  canSeeCost: boolean;
}

const inputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

const MAX_SUGGESTIONS = 8;

export function MaterialManager({ serviceId, canSeeCost }: MaterialManagerProps) {
  const materials = useAppStore((s) => s.materials);
  const serviceMaterials = useAppStore((s) => s.serviceMaterials);
  const loadServiceMaterials = useAppStore((s) => s.loadServiceMaterials);
  const attachMaterial = useAppStore((s) => s.attachMaterial);
  const detachMaterial = useAppStore((s) => s.detachMaterial);
  const addMaterial = useAppStore((s) => s.addMaterial);

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCost, setNewCost] = useState("");
  const [newUom, setNewUom] = useState("each");
  const [error, setError] = useState<string | null>(null);

  // Lazy per-service load, once per reveal (loadServiceMaterials replaces whatever was
  // previously loaded for this serviceId, so re-opening can't accumulate stale rows).
  useEffect(() => {
    if (!canSeeCost) return;
    void loadServiceMaterials(serviceId);
  }, [serviceId, canSeeCost, loadServiceMaterials]);

  // Fail-closed: never render cost data for a role that shouldn't see it.
  if (!canSeeCost) return null;

  const attached = serviceMaterials.filter((l) => l.serviceId === serviceId);
  const attachedIds = new Set(attached.map((l) => l.materialId));

  // Advisory cost basis — pure client-side sum, never written back to the service price.
  const partsCost = attached.reduce((sum, l) => {
    const material = materials.find((m) => m.id === l.materialId);
    return material ? sum + material.unitCost * l.quantity : sum;
  }, 0);

  const q = search.trim().toLowerCase();
  const suggestions = q
    ? materials
        .filter((m) => !attachedIds.has(m.id) && m.name.toLowerCase().includes(q))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  async function handleAttachExisting(materialId: string) {
    const result = await attachMaterial(serviceId, materialId, 1);
    if (result.ok) {
      setSearch("");
      setError(null);
    } else if (result.reason === "failed") {
      setError("Couldn’t add that part — check your connection and try again.");
    }
  }

  async function handleQuantityChange(materialId: string, quantity: number) {
    if (!(quantity > 0)) return; // ignore invalid/blank input — no mutation for garbage input
    const result = await attachMaterial(serviceId, materialId, quantity);
    if (!result.ok && result.reason === "failed") {
      setError("Couldn’t update that quantity — check your connection and try again.");
    }
  }

  async function handleCreateAndAttach() {
    const name = newName.trim();
    const cost = Number(newCost);
    if (!name || !(cost >= 0)) {
      setError("Enter a name and a cost of $0 or more.");
      return;
    }

    const cmd: AddMaterialFields = { name, unitCost: cost, unitOfMeasure: newUom.trim() || "each" };
    const result = await addMaterial(cmd);
    if (!result.ok) {
      setError(
        result.reason === "duplicate"
          ? "That material is already in your catalog — search for it above."
          : "Couldn’t create that material — check your connection and try again.",
      );
      return;
    }

    // addMaterial's Result doesn't carry the new id — read the store's fresh state
    // (not this render's closured `materials`) and match by name; the store's own
    // addMaterial rejects duplicates case-insensitively, so the name is unique.
    const created = useAppStore
      .getState()
      .materials.find((m) => m.name.trim().toLowerCase() === name.toLowerCase());
    if (!created) {
      setError("Created the material, but couldn’t find it to attach — try adding it from the search above.");
      return;
    }

    const attachResult = await attachMaterial(serviceId, created.id, 1);
    if (!attachResult.ok) {
      setError("Created the material, but couldn’t attach it — try again.");
      return;
    }

    setNewName("");
    setNewCost("");
    setNewUom("each");
    setCreating(false);
    setError(null);
  }

  return (
    <div style={{ marginTop: "var(--space-2xs)", paddingTop: "var(--space-3)", borderTop: "1px dashed var(--line)", display: "grid", gap: "var(--space-2)" }}>
      <div style={{ fontSize: "var(--type-sm)", fontWeight: 700, color: "var(--ink-2)" }}>
        Parts — internal only, never shown to the customer
      </div>

      {attached.length > 0 && (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {attached.map((link) => {
            const material = materials.find((m) => m.id === link.materialId);
            if (!material) return null;
            return (
              <PartRow
                key={link.materialId}
                material={material}
                quantity={link.quantity}
                onQuantityChange={(materialId, quantity) => void handleQuantityChange(materialId, quantity)}
                onRemove={(materialId) => detachMaterial(serviceId, materialId)}
              />
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search materials to add…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (error) setError(null);
          }}
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}
        />
        <button className="btn sm ghost" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? "Cancel" : "+ New material"}
        </button>
      </div>

      {suggestions.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {suggestions.map((m) => (
            <div
              key={m.id}
              className="stage-row"
              style={{ cursor: "pointer", padding: "var(--space-2) var(--space-2)" }}
              onClick={() => void handleAttachExisting(m.id)}
              role="button"
            >
              <span style={{ flex: 1 }}>{m.name}</span>
              <span className="muted">{fmt$2(m.unitCost)}/{m.unitOfMeasure}</span>
            </div>
          ))}
        </div>
      )}
      {q && suggestions.length === 0 && !creating && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0" }}>
          No match for “{search}” — create it with “+ New material”.
        </p>
      )}

      {creating && (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Material name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (error) setError(null);
            }}
            style={{ ...inputStyle, flex: 1, minWidth: 140 }}
          />
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            <span className="muted">$</span>
            <input
              type="number"
              min={0}
              step={0.01}
              placeholder="cost"
              value={newCost}
              onChange={(e) => {
                setNewCost(e.target.value);
                if (error) setError(null);
              }}
              style={{ ...inputStyle, width: 78 }}
            />
          </span>
          <input
            type="text"
            placeholder="unit (each)"
            value={newUom}
            onChange={(e) => setNewUom(e.target.value)}
            style={{ ...inputStyle, width: 90 }}
          />
          <button className="btn sm" onClick={() => void handleCreateAndAttach()}>+ Add part</button>
        </div>
      )}

      {error && <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "0" }}>{error}</p>}

      <p className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 600, margin: "0" }}>
        {attached.length > 0
          ? `Parts cost ${fmt$2(partsCost)} → price basis`
          : "No parts added — the flat price above stays the source of truth."}
      </p>
    </div>
  );
}
