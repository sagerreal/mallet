"use client";

/**
 * features/office/assemblies-panel.tsx
 * The pricebook's Assemblies card — recipe-priced scopes ("Driveway
 * replacement, 3-inch") in the same quiet register as the services list.
 * Level 0: name → how it prices. Clicking a row reveals "Your numbers"
 * IN-FLOW (service-row's svced grammar): every org-tunable constant as a
 * plain-vocabulary dial ("Hot-mix price — $120 per ton"), edited inline.
 * Editing materializes the org's override (copy-on-write, assemblies-slice);
 * a dial off its shipped value grows a per-field "Reset" that writes the
 * default back through the same path. Values convert per-dial via
 * dialDisplayValue/dialRawValue — the store keeps engine units (cents/bps).
 *
 * Catalog rows deliberately carry no remove control in v1 (an empty book has
 * no restore surface yet); org-authored customs (API-created) do.
 */

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { AssemblyView, AssemblyDialViewDTO } from "@/lib/store/assemblies-mapper";
import {
  dialDisplayValue,
  dialRawValue,
  type DialFormat,
} from "@/modules/assemblies/domain/assembly-dials";
import { useFieldId } from "@/components/ui/input";

/** The level-0 row's value: how this assembly prices. */
function pricingSummary(assembly: AssemblyView): string {
  const unit = assembly.measurementBasis === "perimeter" ? "ln ft" : "sq ft";
  if (assembly.pricingMode === "cost_plus") {
    return `Cost + ${assembly.marginBps / 100}%`;
  }
  const first = assembly.config.tiers?.[0];
  return first ? `$${(first.rateCents / 100).toFixed(2)}/${unit}` : "Unit rate";
}

const BASIS_LABEL: Record<AssemblyView["measurementBasis"], string> = {
  area: "Priced from traced area",
  perimeter: "Priced from traced perimeter",
  line: "Priced from measured length",
  count: "Priced per unit",
};

function dialText(format: DialFormat, raw: number): string {
  const display = dialDisplayValue(format, raw);
  return Number.isInteger(display) ? String(display) : String(Math.round(display * 100) / 100);
}

/** One dial — label · input (format-aware) · unit hint · per-field reset. */
function DialRow({
  dial,
  onSave,
}: {
  dial: AssemblyDialViewDTO;
  onSave: (rawValue: number) => void;
}) {
  const field = useFieldId();
  const [text, setText] = useState(() => dialText(dial.format, dial.currentRaw));
  const edited = dial.currentRaw !== dial.defaultRaw;
  const money = dial.format === "dollars";
  const percent = dial.format === "percentBps" || dial.format === "wastePercent";

  function commit(value: string) {
    setText(value);
    const parsed = Number(value);
    if (value.trim() === "" || !Number.isFinite(parsed)) return; // keep typing
    const raw = dialRawValue(dial.format, parsed);
    if (raw !== null) onSave(raw);
  }

  function reset() {
    setText(dialText(dial.format, dial.defaultRaw));
    onSave(dial.defaultRaw);
  }

  return (
    <>
      <label className="svced-l" {...field.labelProps}>
        {dial.label}
      </label>
      <div className="svced-c">
        <span className={percent ? "min suf" : "min"}>
          {money && <span className="pre">$</span>}
          <input
            {...field.controlProps}
            type="number"
            inputMode="decimal"
            min={0}
            value={text}
            onChange={(e) => commit(e.target.value)}
          />
          {percent && <span className="pre">%</span>}
        </span>
        <span className="svced-hint">
          {dial.unitSuffix ?? ""}
          {edited && (
            <>
              {dial.unitSuffix ? " · " : ""}
              <button type="button" className="linklike" onClick={reset}>
                Reset to {money ? `$${dialText("dollars", dial.defaultRaw)}` : dialText(dial.format, dial.defaultRaw)}
              </button>
            </>
          )}
        </span>
      </div>
    </>
  );
}

function AssemblyRow({
  assembly,
  onSaveDial,
  onArchive,
}: {
  assembly: AssemblyView;
  onSaveDial: (id: string, dialKey: string, rawValue: number) => void;
  onArchive: (id: string) => void;
}) {
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
        <span style={{ flex: 1, fontWeight: 600 }}>
          {assembly.name}
          {assembly.isOverride && (
            <span className="muted" style={{ fontWeight: 400, fontSize: "var(--type-sm)" }}>
              {" "}
              · your numbers
            </span>
          )}
        </span>
        <span style={{ fontWeight: 700, textAlign: "right" }}>{pricingSummary(assembly)}</span>
        <span className="caret" style={{ color: "var(--ink-3)" }} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </div>

      {open && (
        <div className="svced">
          <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0 0 var(--space-3)" }}>
            {BASIS_LABEL[assembly.measurementBasis]} — your numbers below; shipped values stay
            one reset away.
          </p>
          <div className="svced-grid">
            {assembly.dials.map((dial) => (
              <DialRow
                key={dial.key}
                dial={dial}
                onSave={(raw) => onSaveDial(assembly.id, dial.key, raw)}
              />
            ))}
          </div>
          {assembly.catalogKey === null && (
            <div className="svced-foot">
              <button className="svced-rm" onClick={() => onArchive(assembly.id)}>
                Remove assembly
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AssembliesPanel() {
  const assemblies = useAppStore((s) => s.assemblies);
  const saveAssemblyDial = useAppStore((s) => s.saveAssemblyDial);
  const archiveAssembly = useAppStore((s) => s.archiveAssembly);
  const [saveFailed, setSaveFailed] = useState(false);

  async function handleSave(id: string, dialKey: string, rawValue: number) {
    setSaveFailed(false);
    const result = await saveAssemblyDial(id, dialKey, rawValue);
    if (!result.ok) setSaveFailed(true);
  }

  if (assemblies.length === 0) {
    return (
      <div className="empty-att" style={{ margin: "var(--space-3) var(--space-4)" }}>
        No assemblies on your book.
      </div>
    );
  }

  return (
    <div style={{ padding: "0 var(--space-4)" }}>
      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-3) 0" }}>
        A traced surface prices through these recipes — materials, labor, trucking — using your
        numbers. Seed one from the quote composer&rsquo;s Measure panel.
      </p>
      {assemblies.map((assembly) => (
        <AssemblyRow
          key={assembly.id}
          assembly={assembly}
          onSaveDial={(id, dialKey, raw) => void handleSave(id, dialKey, raw)}
          onArchive={archiveAssembly}
        />
      ))}
      {saveFailed && (
        <p role="alert" style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0" }}>
          Couldn&rsquo;t save that number — check your connection and try again.
        </p>
      )}
    </div>
  );
}
