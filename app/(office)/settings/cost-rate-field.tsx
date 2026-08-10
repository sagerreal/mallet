"use client";

/**
 * app/(office)/settings/cost-rate-field.tsx
 * What an hour of this person costs the shop — the one number job costing needs.
 *
 * BURDENED, AND THE LABEL SAYS SO. A rate entered as the bare wage understates labour by roughly a
 * third (Housecall Pro's own worked example: a $25/h W-2 employee costs $32–35/h loaded), and a
 * job costed off it reports a profit the shop never made. Since the field cannot make anyone do
 * the arithmetic, it offers to: type the wage, add a burden %, and it fills the box in.
 *
 * BLANK IS A REAL ANSWER. An empty rate means "we have not worked this out", and costing then
 * reports that person's hours with no money against them. Forcing a number makes shops guess, and
 * a guessed cost rate is worse than a blank one — it produces a margin figure somebody believes.
 *
 * Expands in flow, under its own row. No popover — house rule.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import { COMPACT_INPUT } from "@/components/ui/input";

/** The middle of the trades range. Only ever a starting point in the helper, never a stored value. */
const DEFAULT_BURDEN_PCT = 30;

/**
 * A visible edge, matching the certification input beside it.
 *
 * These sat borderless, right-aligned, with an em dash for a placeholder — indistinguishable from
 * a printed figure. A shop owner reading "Costs the shop  —  / hour" has no reason to think it is
 * a box they can type in. `--line-strong` is the form-control boundary token (>=3:1 on every
 * surface a control can sit on) and exists precisely for this.
 */
const BOX = {
  border: "1.5px solid var(--line-strong)",
  background: "var(--card)",
  textAlign: "right",
} as const;

const centsToInput = (cents: number | null): string => (cents === null ? "" : (cents / 100).toFixed(2));

/** "32.50" → 3250. Returns null for blank, undefined for anything that is not a number. */
const inputToCents = (raw: string): number | null | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed.replace(/^\$/, ""));
  if (!Number.isFinite(asNumber) || asNumber < 0) return undefined;
  return Math.round(asNumber * 100);
};

interface CostRateFieldProps {
  memberId: string;
  costRateCents: number | null;
}

export function CostRateField({ memberId, costRateCents }: CostRateFieldProps) {
  const utils = api.useUtils();
  const [value, setValue] = useState(() => centsToInput(costRateCents));
  const [error, setError] = useState<string | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const [wage, setWage] = useState("");
  const [burden, setBurden] = useState(String(DEFAULT_BURDEN_PCT));

  const save = api.v1.identity.setMemberCostRate.useMutation({
    onSuccess: () => {
      utils.v1.identity.members.invalidate().catch(() => {});
      utils.v1.jobs.laborByJob.invalidate().catch(() => {});
    },
    onError: (e: unknown) => setError(userMessage(e)),
  });

  const commit = (raw: string) => {
    const cents = inputToCents(raw);
    if (cents === undefined) {
      setError("Enter an hourly amount, like 32.50.");
      return;
    }
    setError(null);
    // Unchanged — don't spend a write, and don't flash a save on a blur that changed nothing.
    if (cents === costRateCents) return;
    save.mutate({ userId: memberId, costRateCents: cents });
  };

  const applyHelper = () => {
    const base = Number(wage.replace(/^\$/, ""));
    const pct = Number(burden);
    if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct) || pct < 0) {
      setError("Enter the hourly wage and a burden percentage.");
      return;
    }
    const loaded = (base * (1 + pct / 100)).toFixed(2);
    setValue(loaded);
    setHelperOpen(false);
    commit(loaded);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", paddingTop: "var(--space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <label htmlFor={`cost-rate-${memberId}`} style={{ fontSize: "var(--type-sm)" }}>
          Costs the shop
        </label>
        <input
          id={`cost-rate-${memberId}`}
          inputMode="decimal"
          placeholder="—"
          value={value}
          disabled={save.isPending}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onBlur={(e) => commit(e.target.value)}
          style={{ ...COMPACT_INPUT, ...BOX, width: "10ch" }}
        />
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>/ hour, fully loaded</span>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => setHelperOpen((open) => !open)}
          aria-expanded={helperOpen}
        >
          {helperOpen ? "Close" : "Work it out"}
        </button>
      </div>

      {helperOpen && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            flexWrap: "wrap",
            paddingTop: "var(--space-1)",
          }}
        >
          <label htmlFor={`wage-${memberId}`} style={{ fontSize: "var(--type-sm)" }}>
            Hourly wage
          </label>
          <input
            id={`wage-${memberId}`}
            inputMode="decimal"
            value={wage}
            onChange={(e) => setWage(e.target.value)}
            style={{ ...COMPACT_INPUT, ...BOX, width: "10ch" }}
          />
          <label htmlFor={`burden-${memberId}`} style={{ fontSize: "var(--type-sm)" }}>
            plus
          </label>
          <input
            id={`burden-${memberId}`}
            inputMode="decimal"
            value={burden}
            onChange={(e) => setBurden(e.target.value)}
            style={{ ...COMPACT_INPUT, ...BOX, width: "7ch" }}
          />
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            % for tax, insurance, truck
          </span>
          <button type="button" className="btn sm" onClick={applyHelper}>
            Use it
          </button>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: "var(--red-700)", fontSize: "var(--type-sm)" }}>
          {error}
        </div>
      )}
      {!error && value === "" && (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          Leave blank and job costing shows their hours without a cost.
        </span>
      )}
    </div>
  );
}
