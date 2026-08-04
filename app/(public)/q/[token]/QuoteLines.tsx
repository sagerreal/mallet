/**
 * app/(public)/q/[token]/QuoteLines.tsx
 *
 * Client-component island for the interactive part of the public quote page:
 * optional add-on toggles + live totals + the approve/decline actions — and,
 * on a Good/Better/Best quote, the three-option tier picker above them.
 *
 * Two modes, discriminated by the `tiers` prop:
 *   - single (tiers absent): fixed lines are server-rendered by the page; the
 *     island gets their subtotal + the optional add-ons. Unchanged behavior.
 *   - tiered (tiers present): the island renders the picker (default selection
 *     = recommended tier), the SELECTED tier's fixed lines, and that tier's
 *     optional add-ons. Switching tiers resets the add-on selection (line ids
 *     are scoped to a tier) and recomputes every total.
 *
 * The customer can include/exclude OPTIONAL add-on lines before accepting; the
 * subtotal/discount/tax/total/deposit and the Approve button amount recompute on
 * every toggle. Only the chosen tier + selected line IDs are sent on accept —
 * the server builds the committed lines from its stored estimate, never from
 * client content.
 *
 * LOCK: the accept-flow phase is owned here and passed down to QuoteActions, so
 * the toggles AND the tier cards disable while an accept/decline is in flight
 * and permanently once approved/declined; on success the selection freezes to
 * the ids actually sent. The displayed total therefore always matches the
 * committed one.
 *
 * Cents math lives in quote-totals.ts and mirrors the domain's derivations
 * (modules/quoting/domain/estimate.ts) exactly, so the approved number matches
 * what the server commits.
 *
 * Design rules: anchored, in-flow, no floating UI. With zero optional lines the
 * single-mode rendered output is identical to the previous static totals + actions.
 */

"use client";

import { useState } from "react";
import { fmt$ } from "@/lib/format";
import type { QuoteTier } from "@/modules/quoting/domain/estimate";
import { LineRow } from "./LineRow";
import { QuoteActions, PayDepositButton, type QuotePhase } from "./QuoteActions";
import { TierPicker } from "./TierPicker";
import { computeQuoteTotals, lineAmountCents, sumLineAmountsCents } from "./quote-totals";

function centsToDisplay(cents: number): string {
  return fmt$(cents / 100);
}

export interface QuoteLineView {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
}

/** One Good/Better/Best option as the public page sees it (redacted — no costs). */
export interface TierLinesView {
  readonly tier: QuoteTier;
  readonly name: string;
  readonly fixedLines: readonly QuoteLineView[];
  readonly optionalLines: readonly QuoteLineView[];
  /** The tier's full total (fixed lines through discount/tax), server-computed. */
  readonly totalCents: number;
}

interface QuoteLinesBaseProps {
  readonly discBps: number;
  readonly taxBps: number;
  readonly depBps: number;
  readonly token: string;
  /** The shop's name — it appears in the authorisation sentence the customer signs, so the
   *  document names a counterparty rather than "the contractor". */
  readonly orgName: string;
  readonly changeAlreadyRequested: boolean;
  /**
   * The quote is already accepted or declined, so render it as a RECORD: lines, totals and terms
   * still visible, no way to change the selection or act again.
   *
   * The page used to replace the whole quote with "Approved — thank you!", so the moment a customer
   * approved they could no longer see what they had approved. That is the one clear legal defect in
   * this flow: ESIGN (15 U.S.C. § 7001(e)) lets an electronic record be denied legal effect if it
   * cannot "be retained and accurately reproduced for later reference by all parties" — and the
   * approval IS the agreement, so the agreement has to stay readable.
   */
  readonly settled?: boolean;
  /**
   * The deposit still owed on an ALREADY-accepted quote, and payable right now — the page computes
   * it from stored data (depositDue − depPaid, zeroed when the shop can't take a card or the
   * amount is under the card minimum). 0 means render no deposit button at all.
   *
   * Only used on the `settled` path: a quote approved in THIS session has nothing paid yet, so
   * QuoteActions uses the live computed deposit instead — the server-rendered number here was
   * captured before the customer's add-on selection was committed.
   */
  readonly payableDepositCents?: number;
  /** Can the shop take a card at all (Connect onboarded + charges enabled). */
  readonly cardPaymentAvailable?: boolean;
}

interface SingleQuoteLinesProps extends QuoteLinesBaseProps {
  readonly tiers?: null;
  /** Sum of the fixed (non-optional) line amounts, computed server-side. */
  readonly fixedSubtotalCents: number;
  readonly optionalLines: readonly QuoteLineView[];
}

interface TieredQuoteLinesProps extends QuoteLinesBaseProps {
  readonly tiers: readonly TierLinesView[];
  readonly recommendedTier: QuoteTier;
}

export type QuoteLinesProps = SingleQuoteLinesProps | TieredQuoteLinesProps;

// ---- totals block (recomputes on every toggle / tier switch) -----------------

function TotalsBlock({
  subtotalCents,
  discountCents,
  taxCents,
  totalCents,
  depositCents,
  discBps,
  taxBps,
  depBps,
}: {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  discBps: number;
  taxBps: number;
  depBps: number;
}) {
  const disc = discBps / 100; // bps → percent
  const tax = taxBps / 100;
  const dep = depBps / 100;
  const showSub = discBps > 0 || taxBps > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "var(--space-1)",
        padding: "var(--space-4) 0 var(--space-1)",
      }}
    >
      {showSub && (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Subtotal {centsToDisplay(subtotalCents)}
        </div>
      )}
      {discBps > 0 && (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Discount {disc}% −{centsToDisplay(discountCents)}
        </div>
      )}
      {taxBps > 0 && (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Tax {tax}% +{centsToDisplay(taxCents)}
        </div>
      )}
      <div style={{ fontWeight: 900, fontSize: "var(--type-xl)" }}>
        Total {centsToDisplay(totalCents)}
      </div>
      {dep > 0 && (
        <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {centsToDisplay(depositCents)} deposit due today &middot; the rest when the job&rsquo;s done
        </div>
      )}
    </div>
  );
}

// ---- optional add-on toggles --------------------------------------------------

function AddonToggles({
  lines,
  selectedIds,
  locked,
  onToggle,
}: {
  lines: readonly QuoteLineView[];
  selectedIds: ReadonlySet<string>;
  locked: boolean;
  onToggle: (id: string, on: boolean) => void;
}) {
  if (lines.length === 0) return null;
  return (
    <>
      <div className="muted" style={{ fontSize: "var(--type-xs)", marginTop: "var(--space-3)", marginBottom: "var(--space-1)" }}>
        Optional add-ons &mdash; tap to include
      </div>
      {lines.map((line) => {
        const amount = lineAmountCents(line.quantity, line.rateCents);
        return (
          <label key={line.id} className="addonrow">
            <input
              type="checkbox"
              checked={selectedIds.has(line.id)}
              disabled={locked}
              onChange={(e) => onToggle(line.id, e.target.checked)}
            />
            <span style={{ flex: 1 }}>
              <b>Add:</b> {line.description}
              {line.quantity !== 1 ? ` × ${line.quantity}` : ""}
            </span>
            <b>+{centsToDisplay(amount)}</b>
          </label>
        );
      })}
    </>
  );
}

// ---- line resolution ----------------------------------------------------------

interface ResolvedLines {
  readonly activeTier: TierLinesView | null;
  readonly optionalLines: readonly QuoteLineView[];
  readonly fixedSubtotalCents: number;
}

/** Which lines the totals derive from: the selected tier's on a GBB quote
 *  (fixed subtotal derived client-side with the domain's per-line rounding),
 *  the page-provided ones on a single quote. */
function resolveLines(props: QuoteLinesProps, selectedTier: QuoteTier | null): ResolvedLines {
  if (props.tiers == null) {
    return {
      activeTier: null,
      optionalLines: props.optionalLines,
      fixedSubtotalCents: props.fixedSubtotalCents,
    };
  }
  const activeTier = props.tiers.find((t) => t.tier === selectedTier) ?? null;
  return {
    activeTier,
    optionalLines: activeTier?.optionalLines ?? [],
    fixedSubtotalCents: activeTier ? sumLineAmountsCents(activeTier.fixedLines) : 0,
  };
}

// ---- island -----------------------------------------------------------------

export function QuoteLines(props: QuoteLinesProps) {
  const {
    discBps,
    taxBps,
    depBps,
    token,
    orgName,
    changeAlreadyRequested,
    settled = false,
    payableDepositCents = 0,
    cardPaymentAvailable = false,
  } = props;
  const tiered = props.tiers != null ? props : null;

  // Good/Better/Best: which option the customer is looking at. Defaults to the
  // recommended tier; null on single quotes.
  const [selectedTier, setSelectedTier] = useState<QuoteTier | null>(
    tiered?.recommendedTier ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // Accept-flow phase lives HERE (not in QuoteActions) so the toggles and tier
  // cards lock the moment an accept/decline is in flight and stay locked once
  // terminal — the displayed total can never diverge from the committed one.
  const [phase, setPhase] = useState<QuotePhase>("idle");
  // `settled` locks a quote that was already settled on an EARLIER visit (the phase states only
  // cover this one). A declined quote still lists its add-ons — read-only, as what was on offer.
  // "signing" locks too: the sentence in the signature panel names a specific amount, so a toggle
  // that changed the total while the pad was open would have the customer sign for a number that
  // is no longer on screen.
  const locked =
    settled ||
    phase === "busy" ||
    phase === "signing" ||
    phase === "approved" ||
    phase === "declined";

  const { activeTier, optionalLines, fixedSubtotalCents } = resolveLines(props, selectedTier);

  function handlePhaseChange(next: QuotePhase, committedLineIds?: readonly string[]): void {
    if (next === "approved" && committedLineIds) {
      // Freeze the totals to the selection that was actually SENT with the accept.
      setSelectedIds(new Set(committedLineIds));
    }
    setPhase(next);
  }

  function selectTier(tier: QuoteTier): void {
    if (locked || tier === selectedTier) return; // same lock as the add-on toggles
    setSelectedTier(tier);
    // Optional add-on ids are scoped to a tier — switching resets the selection
    // so the accept POST can never carry another tier's line ids.
    setSelectedIds(new Set());
  }

  function toggle(id: string, on: boolean): void {
    if (locked) return; // belt-and-braces alongside the checkbox disabled prop
    setSelectedIds((prev) => {
      const next = new Set(prev); // new Set per toggle — never mutate state in place
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const totals = computeQuoteTotals({
    fixedSubtotalCents,
    selectedOptionalLines: optionalLines.filter((line) => selectedIds.has(line.id)),
    discBps,
    taxBps,
    depBps,
  });

  return (
    <>
      {/* Good/Better/Best picker + the selected tier's fixed lines. With one
          real tier there is nothing to choose — the picker hides and the tier
          renders as a single quote (accept still carries its tier key). */}
      {tiered && selectedTier && tiered.tiers.length > 1 && (
        <TierPicker
          options={tiered.tiers}
          selectedTier={selectedTier}
          recommendedTier={tiered.recommendedTier}
          locked={locked}
          onSelect={selectTier}
        />
      )}
      {activeTier?.fixedLines.map((line) => (
        <LineRow
          key={line.id}
          description={line.description}
          quantity={line.quantity}
          rateCents={line.rateCents}
        />
      ))}

      {/* Optional add-ons — customer toggles what to include */}
      <AddonToggles
        lines={optionalLines}
        selectedIds={selectedIds}
        locked={locked}
        onToggle={toggle}
      />

      {/* Totals — recompute on every toggle / tier switch */}
      <TotalsBlock {...totals} discBps={discBps} taxBps={taxBps} depBps={depBps} />

      {/* Approve / decline / request-change — gone once the quote is settled. The page above states
          the outcome; offering the buttons again would invite a second decision on something
          already decided (the server refuses it, but a dead button is worse than no button). */}
      {!settled && (
        <QuoteActions
          token={token}
          totalCents={totals.totalCents}
          orgName={orgName}
          depositCents={totals.depositCents}
          cardPaymentAvailable={cardPaymentAvailable}
          changeAlreadyRequested={changeAlreadyRequested}
          selectedLineIds={[...selectedIds]}
          chosenTier={selectedTier}
          phase={phase}
          onPhaseChange={handlePhaseChange}
        />
      )}

      {/* Returning to an approved quote whose deposit is still owed. The approve/decline buttons
          are correctly gone (that decision is made), but the deposit is an OPEN action — dropping
          it here would leave the customer holding a link that asks for money it gives them no way
          to pay. Zero when nothing is owed or the shop can't take a card, so nothing renders. */}
      {settled && payableDepositCents > 0 && (
        <PayDepositButton token={token} amountCents={payableDepositCents} />
      )}
    </>
  );
}
