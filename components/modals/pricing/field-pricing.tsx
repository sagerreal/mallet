/**
 * components/modals/pricing/field-pricing.tsx
 * Discount, tax and deposit for the FIELD quote builder — the three controls the office composer's
 * pricing-card has always had and a technician at a customer's door has never had.
 *
 * WHY THIS IS NOT THE OFFICE CARD.
 * The office card is one collapsible box holding three always-open number fields side by side.
 * That is a desk: a wide viewport, a mouse, and a person who opens the box because pricing is the
 * step they are on. A doorstep is not a desk. The technician is holding a phone in one hand with a
 * customer watching, and on any given job he needs ONE of these three — usually none. So each is
 * its own DisclosureRow: collapsed to a label and its LIVE value ("None" / "8.75%" / "$250.00"),
 * one open at a time, editor expanding in flow beneath the row it belongs to. The collapsed value
 * is the summary, which is exactly what DisclosureRow is for, and it means the tech can read the
 * whole pricing state without opening anything.
 *
 * The whole group appears only once a line is priced — there is nothing to discount or tax before
 * that, and an empty builder should show the price list, not a tax form.
 *
 * PERCENT OR DOLLARS. Discount and deposit each take a % or a $ (Jobber's model, and the way a
 * technician actually talks: "I'll knock fifty off", not "I'll knock 3.33% off"). The domain stores
 * basis points only, so a dollar amount is converted at this boundary — and the breakdown below
 * always renders the amount DERIVED from the stored rate, never the number that was typed, so what
 * is on screen is what will be signed and billed. Tax is a rate by nature and takes only a %.
 */

"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type { PricingRates, PricedTotals } from "@mallet/shared/types";
import { money, deriveTotals, BPS_DENOMINATOR } from "@mallet/shared/types";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { Segmented } from "@/app/(office)/settings/segmented";
import { COMPACT_INPUT } from "@/components/ui/input";
import { fmt$2 } from "@/lib/format";

/** Percent of the base, or a flat dollar figure. */
export type RateMode = "pct" | "amt";

/**
 * What the tech has set, in the units he typed them in. Percentages, and dollar amounts in DOLLARS
 * — the store's money unit. Nothing here is a basis point: the conversion happens in one place
 * (fieldPricingRates) so a screen and a signature can never disagree about it.
 */
export interface FieldPricing {
  readonly discMode: RateMode;
  readonly discPct: number;
  readonly discAmt: number;
  readonly taxPct: number;
  readonly depMode: RateMode;
  readonly depPct: number;
  readonly depAmt: number;
}

export const NO_FIELD_PRICING: FieldPricing = {
  discMode: "pct",
  discPct: 0,
  discAmt: 0,
  taxPct: 0,
  depMode: "pct",
  depPct: 0,
  depAmt: 0,
};

/** The office setting is capped at 25% (updateConfigInput) and so is the wire — mirror it here. */
const MAX_TAX_PCT = 25;

const pctToBps = (pct: number): number =>
  Math.min(BPS_DENOMINATOR, Math.max(0, Math.round((Number.isFinite(pct) ? pct : 0) * 100)));

/**
 * A flat dollar amount as a share of the base it comes off.
 *
 * Clamped to 100%: a $600 discount on a $500 job cannot take more than the job is worth, and the
 * breakdown renders the DERIVED amount ($500.00, not $600.00) so the clamp is on screen rather
 * than silent. Zero base means zero — dividing by it would produce Infinity and a signed sentence
 * naming NaN.
 */
const amtToBps = (dollars: number, baseCents: number): number => {
  if (baseCents <= 0 || !Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.min(BPS_DENOMINATOR, Math.round((Math.round(dollars * 100) / baseCents) * BPS_DENOMINATOR));
};

/**
 * The three rates, in basis points — the ONE conversion from what was typed to what is stored.
 *
 * Ordered because the chain is: the discount comes off the subtotal, the tax is charged on what is
 * left, and the deposit is a share of the TAX-INCLUSIVE total. A deposit entered in dollars can
 * therefore only be turned into a rate once the first two are known, which is why this runs the
 * chain once with no deposit before deriving the deposit's own rate.
 */
export function fieldPricingRates(pricing: FieldPricing, subtotalCents: number): PricingRates {
  const subtotal = money(Math.max(0, Math.round(subtotalCents)));
  const discBps =
    pricing.discMode === "pct" ? pctToBps(pricing.discPct) : amtToBps(pricing.discAmt, subtotal);
  const taxBps = pctToBps(Math.min(MAX_TAX_PCT, Math.max(0, pricing.taxPct)));
  const beforeDeposit = deriveTotals(subtotal, subtotal, { discBps, taxBps, depBps: 0 });
  const depBps =
    pricing.depMode === "pct" ? pctToBps(pricing.depPct) : amtToBps(pricing.depAmt, beforeDeposit.total);
  return { discBps, taxBps, depBps };
}

/**
 * Every figure the customer is about to see, derived from the stored rates.
 *
 * Field lines are all taxable (JobLine defaults to it, and the field builder has no per-line
 * taxability control), so the taxable base IS the subtotal here. When per-line taxability reaches
 * this surface, this is the one line that changes.
 */
export function fieldPricingTotals(pricing: FieldPricing, subtotalCents: number): PricedTotals {
  const subtotal = money(Math.max(0, Math.round(subtotalCents)));
  return deriveTotals(subtotal, subtotal, fieldPricingRates(pricing, subtotal));
}

/** True once anything has been set — drives whether the breakdown replaces the plain total. */
export const hasFieldPricing = (rates: PricingRates): boolean =>
  rates.discBps > 0 || rates.taxBps > 0 || rates.depBps > 0;

// ---- the rows ---------------------------------------------------------------

/** Which row's editor is open. Only one at a time — one thumb, one thing. */
type OpenRow = "disc" | "tax" | "dep" | null;

const pctLabel = (pct: number): string => `${Number(pct.toFixed(4))}%`;

const MODES: ReadonlyArray<{ value: RateMode; label: string }> = [
  { value: "pct", label: "%" },
  { value: "amt", label: "$" },
];

const numberOrZero = (raw: string): number => Math.max(0, Number.parseFloat(raw) || 0);

/**
 * The one number-input treatment on this surface. A shared const rather than a per-input literal:
 * these two controls must be the same size and the same target, and a `.field` wrapper would put a
 * second label above a row that already has one.
 */
const RATE_INPUT: CSSProperties = {
  ...COMPACT_INPUT,
  flex: 1,
  minWidth: "var(--space-10)",
  border: "1.5px solid var(--line)",
  fontFamily: "inherit",
  background: "var(--card)",
  color: "var(--ink)",
  boxSizing: "border-box",
};

interface AmountEditorProps {
  mode: RateMode;
  pct: number;
  amt: number;
  /** Cent-precise figure this rate actually produces, so the row states its effect, not its input. */
  derivedCents: number;
  maxPct: number;
  label: string;
  disabled: boolean;
  onMode: (m: RateMode) => void;
  onPct: (v: number) => void;
  onAmt: (v: number) => void;
}

/** Mode toggle + one number input + the amount it works out to. */
function AmountEditor({
  mode,
  pct,
  amt,
  derivedCents,
  maxPct,
  label,
  disabled,
  onMode,
  onPct,
  onAmt,
}: AmountEditorProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)" }}>
      <Segmented value={mode} onChange={onMode} options={MODES} aria-label={`${label} — percent or dollars`} />
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={mode === "pct" ? maxPct : undefined}
        step={mode === "pct" ? 0.25 : 1}
        disabled={disabled}
        aria-label={mode === "pct" ? `${label} percent` : `${label} amount in dollars`}
        value={(mode === "pct" ? pct : amt) || ""}
        placeholder="0"
        onChange={(ev) => (mode === "pct" ? onPct(numberOrZero(ev.target.value)) : onAmt(numberOrZero(ev.target.value)))}
        style={RATE_INPUT}
      />
      <span className="fig" style={{ fontWeight: 700 }}>
        {fmt$2(derivedCents / 100)}
      </span>
    </div>
  );
}

interface TaxRowProps {
  pct: number;
  bps: number;
  taxCents: number;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onPct: (v: number) => void;
}

/**
 * Sales tax — a rate by nature, so no % / $ toggle. Capped at 25% by the same reasoning the office
 * setting is: no US state, county and city combination reaches half of that, so a bigger number is
 * an "825" that lost its decimal point.
 */
function TaxRow({ pct, bps, taxCents, disabled, open, onToggle, onPct }: TaxRowProps) {
  return (
    <DisclosureRow
      label="Sales tax"
      value={bps > 0 ? `${pctLabel(bps / 100)} · ${fmt$2(taxCents / 100)}` : "None"}
      open={open}
      onToggle={onToggle}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_TAX_PCT}
          step={0.25}
          disabled={disabled}
          aria-label="Sales tax percent"
          value={pct || ""}
          placeholder="0"
          onChange={(ev) => onPct(Math.min(MAX_TAX_PCT, numberOrZero(ev.target.value)))}
          style={RATE_INPUT}
        />
        <span aria-hidden="true" style={{ fontWeight: 700 }}>
          %
        </span>
        <span className="fig" style={{ fontWeight: 700 }}>
          {fmt$2(taxCents / 100)}
        </span>
      </div>
    </DisclosureRow>
  );
}

export interface FieldPricingRowsProps {
  pricing: FieldPricing;
  /** Pre-discount line sum, in cents — the base every rate is read against. */
  subtotalCents: number;
  disabled?: boolean;
  /**
   * Offer the Deposit row (default). The office price builder passes false: a job stores no
   * deposit rate — a deposit rides the signed/sent document — and a row whose value silently
   * evaporates on save is worse than no row.
   */
  showDeposit?: boolean;
  onChange: (next: FieldPricing) => void;
}

export function FieldPricingRows({
  pricing,
  subtotalCents,
  disabled = false,
  showDeposit = true,
  onChange,
}: FieldPricingRowsProps) {
  const [open, setOpen] = useState<OpenRow>(null);
  const totals = fieldPricingTotals(pricing, subtotalCents);
  const rates = fieldPricingRates(pricing, subtotalCents);
  const toggle = (row: Exclude<OpenRow, null>) => () => setOpen(open === row ? null : row);
  const patch = (next: Partial<FieldPricing>) => onChange({ ...pricing, ...next });

  return (
    <div className="card" style={{ marginTop: "var(--space-3)", padding: "0 var(--space-3)" }}>
      <DisclosureRow
        label="Discount"
        value={rates.discBps > 0 ? `−${fmt$2(totals.discount / 100)}` : "None"}
        open={open === "disc"}
        onToggle={toggle("disc")}
      >
        <AmountEditor
          mode={pricing.discMode}
          pct={pricing.discPct}
          amt={pricing.discAmt}
          derivedCents={totals.discount}
          maxPct={100}
          label="Discount"
          disabled={disabled}
          onMode={(discMode) => patch({ discMode })}
          onPct={(discPct) => patch({ discPct })}
          onAmt={(discAmt) => patch({ discAmt })}
        />
      </DisclosureRow>

      <TaxRow
        pct={pricing.taxPct}
        bps={rates.taxBps}
        taxCents={totals.tax}
        disabled={disabled}
        open={open === "tax"}
        onToggle={toggle("tax")}
        onPct={(taxPct) => patch({ taxPct })}
      />

      {showDeposit ? (
      <DisclosureRow
        label="Deposit required"
        value={rates.depBps > 0 ? fmt$2(totals.depositDue / 100) : "None"}
        open={open === "dep"}
        onToggle={toggle("dep")}
      >
        <AmountEditor
          mode={pricing.depMode}
          pct={pricing.depPct}
          amt={pricing.depAmt}
          derivedCents={totals.depositDue}
          maxPct={100}
          label="Deposit"
          disabled={disabled}
          onMode={(depMode) => patch({ depMode })}
          onPct={(depPct) => patch({ depPct })}
          onAmt={(depAmt) => patch({ depAmt })}
        />
        {/*
          NOT a cap, and not legal advice. Several states limit what a contractor may take up front
          on home-improvement work (California's is the lesser of $1,000 or 10%), several do not,
          and the limits that exist often apply only to certain contract types. Mallet is national
          and holds no per-state rule set, so a hard ceiling would be wrong somewhere and a silently
          clamped number would be worse than no control at all. The shop is told the constraint
          exists and pointed at its own rules; the figure it types is the figure that is used.
        */}
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          Some states limit deposits on home-improvement work. Check your state&rsquo;s rules.
        </p>
      </DisclosureRow>
      ) : null}
    </div>
  );
}

// ---- the breakdown ----------------------------------------------------------

interface BreakdownRowProps {
  label: string;
  amountCents: number;
  strong?: boolean;
}

function BreakdownRow({ label, amountCents, strong = false }: BreakdownRowProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: strong ? "var(--type-lg)" : "var(--type-base)",
        fontWeight: strong ? 800 : 500,
        padding: "var(--space-1) 0",
      }}
    >
      <span>{label}</span>
      <span className="fig">{fmt$2(amountCents / 100)}</span>
    </div>
  );
}

export interface PriceBreakdownProps {
  totals: PricedTotals;
  rates: PricingRates;
  /** Border colour differs between the edit card (--line) and the manila sign card. */
  ruleColor: string;
}

/**
 * Subtotal → discount → tax → Total, and the deposit under it.
 *
 * Rendered only when a rate is set: with nothing set the subtotal IS the total and a four-row
 * derivation of one number is noise. Every figure is cent-precise — this is the arithmetic behind
 * the sentence the customer signs, and a total rounded to whole dollars beside a sentence naming
 * cents is two different numbers on one screen.
 */
export function PriceBreakdown({ totals, rates, ruleColor }: PriceBreakdownProps) {
  return (
    <div style={{ borderTop: `1px solid ${ruleColor}`, marginTop: "var(--space-2)", paddingTop: "var(--space-2)" }}>
      <BreakdownRow label="Subtotal" amountCents={totals.subtotal} />
      {rates.discBps > 0 ? <BreakdownRow label="Discount" amountCents={-totals.discount} /> : null}
      {rates.taxBps > 0 ? (
        <BreakdownRow label={`Sales tax ${pctLabel(rates.taxBps / 100)}`} amountCents={totals.tax} />
      ) : null}
      <div style={{ borderTop: `1px solid ${ruleColor}`, marginTop: "var(--space-2)", paddingTop: "var(--space-2)" }}>
        <BreakdownRow label="Total" amountCents={totals.total} strong />
        {rates.depBps > 0 ? <BreakdownRow label="Deposit due now" amountCents={totals.depositDue} /> : null}
      </div>
    </div>
  );
}
