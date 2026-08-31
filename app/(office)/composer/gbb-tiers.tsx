"use client";

/**
 * Good / Better / Best tier panels — three always-editable panels stacked
 * in-flow inside the quote card, each reusing the shared line editor.
 * Exactly one tier carries the ★ Recommended radio; that tier's lines are
 * what save / preview / send use (see linesForSend in composer-state.ts).
 */

import { fmt$ } from "@/lib/format";
import {
  gbbTierTotal,
  updateTier,
  type ComposerLine,
  type ComposerState,
  type GBBTier,
  type TierKey,
} from "./composer-state";
import { LineTable } from "./line-table";

const tierInputStyle: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
  background: "var(--card)",
  color: "var(--ink)",
};

export function GbbTiers({
  state,
  onUpdate,
  showCost,
  materialize,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  showCost: boolean;
  materialize?: boolean;
}) {
  const g = state.gbb;
  if (!g) return null;

  function patchTier(k: TierKey, patch: Partial<Omit<GBBTier, "k">>) {
    if (!g) return;
    onUpdate({ gbb: updateTier(g, k, patch) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
      {g.opts.map((tier) => {
        const isRec = g.rec === tier.k;
        return (
          <div
            key={tier.k}
            className="card"
            style={{
              margin: "0",
              border: isRec ? "2px solid var(--green-600)" : undefined,
            }}
          >
            {/* Tier header — editable name/title, the recommended radio, the total */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <input
                value={tier.name}
                aria-label={`${tier.k} tier name`}
                onChange={(e) => patchTier(tier.k, { name: e.target.value })}
                style={{ ...tierInputStyle, width: 110, fontWeight: 700 }}
              />
              <input
                value={tier.title}
                aria-label={`${tier.k} tier title`}
                placeholder="What this option covers"
                onChange={(e) => patchTier(tier.k, { title: e.target.value })}
                style={{ ...tierInputStyle, flex: 1, minWidth: 160 }}
              />
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  fontSize: "var(--type-base)",
                  fontWeight: 700,
                  color: isRec ? "var(--green-700)" : "var(--ink-3)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <input
                  type="radio"
                  name="gbb-recommended"
                  checked={isRec}
                  style={{ accentColor: "var(--ink)" }}
                  onChange={() => onUpdate({ gbb: { ...g, rec: tier.k } })}
                />
                ★ Recommended
              </label>
              <b style={{ fontSize: "var(--type-md)", whiteSpace: "nowrap" }}>
                {fmt$(gbbTierTotal(tier))}
              </b>
            </div>

            {/* Suggestion blurb — set by "Suggest Better & Best from Good" */}
            {tier.note && (
              <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
                {tier.note}
              </p>
            )}

            <LineTable
              priceMode={state.priceDisplay}
              lines={tier.lines}
              showCost={showCost}
              onLines={(next) => patchTier(tier.k, { lines: next })}
              materialize={materialize}
              taxed={(state.pricing.tax ?? 0) > 0}
            />
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "0" }}>
        Customers pick one of the options on their quote page — the recommended
        one is highlighted.
      </p>
    </div>
  );
}
