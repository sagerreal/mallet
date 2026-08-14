"use client";

/**
 * Pricing section — discount / deposit / tax in a boxed card shell.
 * Collapsible: the header row toggles the fields open in-flow.
 */

import { Field } from "@/components/ui/input";
import { MAX_SHARE_PCT, clampSharePct } from "@mallet/shared/types";
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
    <div className="card">
      <div className={`reveal${state.priceOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ priceOpen: !state.priceOpen })}
        >
          <span className="caret">▸</span> Pricing{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — {priceSum || "discount, deposit, tax"}
          </span>
        </div>
        <div className="reveal-body">
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          {/* Discount and deposit are shares of the bill: the domain refuses anything past 100%,
              so the box cannot be allowed to produce it — 150 here used to reach the server as
              15000 bps, which refused the whole draft. */}
          <Field label="Discount %" style={{ flex: 1 }}>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_SHARE_PCT}
              value={state.pricing.disc || ""}
              placeholder="0"
              onChange={(e) =>
                onUpdate({
                  pricing: {
                    ...state.pricing,
                    disc: clampSharePct(+e.target.value || 0),
                  },
                })
              }
            />
          </Field>
          <Field label="Deposit required %" style={{ flex: 1 }}>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_SHARE_PCT}
              value={state.pricing.dep || ""}
              placeholder="0"
              onChange={(e) =>
                onUpdate({
                  pricing: {
                    ...state.pricing,
                    dep: clampSharePct(+e.target.value || 0),
                  },
                })
              }
            />
          </Field>
          <Field label="Tax %" style={{ flex: 1 }}>
            <input
              type="number"
              inputMode="decimal"
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
          </Field>
        </div>
        </div>
      </div>
    </div>
  );
}
