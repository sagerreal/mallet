"use client";

/**
 * features/office/markup-bands-editor.tsx
 * The org's ONE cost-banded parts-markup table (Profit Rhino shape). Rows read
 * "parts costing $X and up → +Y%". Saving replaces the whole table and reprices
 * every rule-mode material; manual prices and existing quotes never move. A shop
 * that wants a flat % keeps the single $0 row.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { userMessage } from "@/lib/trpc/error-map";

interface BandDraft {
  minCost: string; // dollars, as typed
  pct: string; // percent, as typed
}

export function MarkupBandsEditor() {
  const bandsQ = api.v1.pricebook.markupBands.list.useQuery();
  const replaceAll = api.v1.pricebook.markupBands.replaceAll.useMutation();
  const utils = api.useUtils();
  const setMaterials = useAppStore((s) => s.setMaterials);

  const [rows, setRows] = useState<BandDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Seed the draft from the server once (defaults included — the numbers in effect).
  useEffect(() => {
    if (rows === null && bandsQ.data) {
      setRows(
        bandsQ.data.bands.map((b) => ({
          minCost: String(b.minCostCents / 100),
          pct: String(b.markupBps / 100),
        })),
      );
    }
  }, [rows, bandsQ.data]);

  if (!bandsQ.isFetched || rows === null) {
    return <span className="sk" style={{ display: "inline-block", width: 160, height: 12 }} aria-hidden="true" />;
  }

  function patchRow(i: number, patch: Partial<BandDraft>) {
    setRows((prev) => (prev ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setSavedNote(null);
  }

  async function save() {
    setError(null);
    const bands = (rows ?? []).map((r) => ({
      minCostCents: Math.max(0, Math.round(Number(r.minCost) * 100) || 0),
      markupBps: Math.max(0, Math.round(Number(r.pct) * 100) || 0),
    }));
    try {
      const res = await replaceAll.mutateAsync({ bands });
      setSavedNote(res.repriced > 0 ? `Saved — ${res.repriced} part price${res.repriced === 1 ? "" : "s"} updated.` : "Saved.");
      // Rule-mode materials just repriced server-side — refresh the store's copy.
      const fresh = await utils.v1.pricebook.material.list.fetch({ limit: 500 });
      setMaterials(
        fresh.items.map((dto) => ({
          id: dto.id,
          categoryId: dto.categoryId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          unitCost: dto.unitCostCents / 100,
          unitPrice: dto.unitPriceCents / 100,
          pricingMode: dto.pricingMode,
          unitOfMeasure: dto.unitOfMeasure,
          markupBps: dto.markupBps,
          taxable: dto.taxable,
          vendor: dto.vendor,
          active: dto.active,
          position: dto.position,
        })),
      );
    } catch (e: unknown) {
      setError(userMessage(e, "Couldn’t save the table — check your connection and try again."));
    }
  }

  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="stage-row" style={{ gap: "var(--space-2)" }}>
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>parts costing</span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            <span className="muted">$</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={r.minCost}
              aria-label={`Band ${i + 1} cost floor`}
              onChange={(e) => patchRow(i, { minCost: e.target.value })}
              className="field-compact"
              style={{ width: 76 }}
              disabled={i === 0}
              title={i === 0 ? "The first band always starts at $0" : undefined}
            />
          </span>
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>and up →</span>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={r.pct}
              aria-label={`Band ${i + 1} markup percent`}
              onChange={(e) => patchRow(i, { pct: e.target.value })}
              className="field-compact"
              style={{ width: 64 }}
            />
            <span className="muted">%</span>
          </span>
          {rows.length > 1 && i > 0 && (
            <button className="btn sm ghost" aria-label={`Remove band ${i + 1}`} onClick={() => { setRows(rows.filter((_, idx) => idx !== i)); setSavedNote(null); }}>
              ✕
            </button>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn sm ghost"
          onClick={() => {
            const last = rows[rows.length - 1];
            const nextFloor = last ? String((Number(last.minCost) || 0) * 2 || 10) : "0";
            setRows([...rows, { minCost: nextFloor, pct: "50" }]);
            setSavedNote(null);
          }}
        >
          + Add band
        </button>
        <button className="btn sm" onClick={() => void save()} disabled={replaceAll.isPending}>
          {replaceAll.isPending ? "Saving…" : "Save table"}
        </button>
        {savedNote && <span className="muted" style={{ fontSize: "var(--type-sm)" }}>{savedNote}</span>}
      </div>
      {error && <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>{error}</p>}
      <p className="muted" style={{ marginTop: "var(--space-2)", fontSize: "var(--type-sm)" }}>
        Prices rule-priced parts from their cost — cheap fittings marked up hard, big-ticket
        equipment gently. Parts where you typed your own price never move.
      </p>
    </div>
  );
}
