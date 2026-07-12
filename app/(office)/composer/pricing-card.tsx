"use client";

/**
 * Pricing section — discount / deposit / tax. Extracted from the composer
 * page; behavior unchanged.
 */

import { pricingSummary, type ComposerState } from "./composer-state";

export function PricingCard({
  state,
  onUpdate,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
}) {
  const priceSum = pricingSummary(state.pricing);

  return (
    <div className={`reveal${state.priceOpen ? " open" : ""}`}>
      <div
        className="reveal-head"
        onClick={() => onUpdate({ priceOpen: !state.priceOpen })}
      >
        <span className="caret">▸</span> Pricing options{" "}
        <span className="muted" style={{ fontWeight: 500 }}>
          — {priceSum || "discount, deposit, tax"}
        </span>
      </div>
      <div className="reveal-body">
        <div style={{ display: "flex", gap: 14 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Discount %</label>
            <input
              type="number"
              min={0}
              value={state.pricing.disc || ""}
              placeholder="0"
              onChange={(e) =>
                onUpdate({
                  pricing: {
                    ...state.pricing,
                    disc: Math.max(0, +e.target.value || 0),
                  },
                })
              }
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Deposit required %</label>
            <input
              type="number"
              min={0}
              value={state.pricing.dep || ""}
              placeholder="0"
              onChange={(e) =>
                onUpdate({
                  pricing: {
                    ...state.pricing,
                    dep: Math.max(0, +e.target.value || 0),
                  },
                })
              }
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Tax %</label>
            <input
              type="number"
              min={0}
              step={0.25}
              value={state.pricing.tax || ""}
              placeholder="0"
              onChange={(e) =>
                onUpdate({
                  pricing: {
                    ...state.pricing,
                    tax: Math.max(0, +e.target.value || 0),
                  },
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
