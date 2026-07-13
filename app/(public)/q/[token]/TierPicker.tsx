/**
 * app/(public)/q/[token]/TierPicker.tsx
 *
 * The Good/Better/Best three-option picker for the public quote page: three
 * stacked, in-flow cards (option name + total), tap to select. The recommended
 * option is labeled "Recommended"; the selected card carries the accent border.
 *
 * Presentational only — selection state lives in QuoteLines (the island that
 * owns the accept-flow lock), so the cards freeze under exactly the same phase
 * rules as the optional add-on toggles.
 *
 * Mobile-first: full-width cards, ≥44px tap targets, no floating UI.
 */

"use client";

import { fmt$ } from "@/lib/format";
import type { QuoteTier } from "@/modules/quoting/domain/estimate";

export interface TierOption {
  readonly tier: QuoteTier;
  readonly name: string;
  /** The tier's full total (fixed lines through discount/tax), server-computed. */
  readonly totalCents: number;
}

interface TierPickerProps {
  readonly options: readonly TierOption[];
  readonly selectedTier: QuoteTier;
  readonly recommendedTier: QuoteTier;
  /** Mirrors the add-on toggle lock: busy / approved / declined freeze the cards. */
  readonly locked: boolean;
  readonly onSelect: (tier: QuoteTier) => void;
}

export function TierPicker({
  options,
  selectedTier,
  recommendedTier,
  locked,
  onSelect,
}: TierPickerProps) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 6 }}>
        Choose an option
      </div>
      <div
        role="radiogroup"
        aria-label="Quote options"
        style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}
      >
        {options.map((opt) => {
          const selected = opt.tier === selectedTier;
          const recommended = opt.tier === recommendedTier;
          return (
            <button
              key={opt.tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={locked}
              onClick={() => onSelect(opt.tier)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                width: "100%",
                minHeight: 52, // ≥44px tap target — this is a phone surface
                padding: "12px 14px",
                boxSizing: "border-box",
                borderRadius: 10,
                // Constant border WIDTH so selection never shifts layout.
                border: `1.5px solid ${selected ? "var(--accent)" : "var(--line)"}`,
                background: selected ? "var(--green-50)" : "var(--card)",
                color: "var(--ink)",
                fontFamily: "inherit",
                fontSize: 13.5,
                textAlign: "left",
                cursor: locked ? "not-allowed" : "pointer",
                opacity: locked && !selected ? 0.6 : 1,
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <b style={{ fontSize: 14 }}>{opt.name}</b>
                {recommended && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>
                    Recommended
                  </span>
                )}
              </span>
              <b style={{ fontSize: 15 }}>{fmt$(opt.totalCents / 100)}</b>
            </button>
          );
        })}
      </div>
    </>
  );
}
