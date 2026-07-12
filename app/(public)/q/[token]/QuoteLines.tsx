/**
 * app/(public)/q/[token]/QuoteLines.tsx
 *
 * Client-component island for the interactive part of the public quote page:
 * optional add-on toggles + live totals + the approve/decline actions.
 *
 * The customer can include/exclude OPTIONAL add-on lines before accepting; the
 * subtotal/discount/tax/total/deposit and the Approve button amount recompute on
 * every toggle. Only the selected line IDs are sent on accept — the server builds
 * the committed lines from its stored estimate, never from client content.
 *
 * Cents math lives in quote-totals.ts and mirrors the domain's derivations
 * (modules/quoting/domain/estimate.ts) exactly, so the approved number matches
 * what the server commits.
 *
 * Design rules: anchored, in-flow, no floating UI. With zero optional lines the
 * rendered output is identical to the previous static totals + actions.
 */

"use client";

import { useState } from "react";
import { fmt$ } from "@/lib/format";
import { QuoteActions } from "./QuoteActions";
import { computeQuoteTotals, lineAmountCents } from "./quote-totals";

function centsToDisplay(cents: number): string {
  return fmt$(cents / 100);
}

export interface OptionalLineView {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
}

interface QuoteLinesProps {
  /** Sum of the fixed (non-optional) line amounts, computed server-side. */
  readonly fixedSubtotalCents: number;
  readonly optionalLines: readonly OptionalLineView[];
  readonly discBps: number;
  readonly taxBps: number;
  readonly depBps: number;
  readonly token: string;
  readonly changeAlreadyRequested: boolean;
}

// ---- totals block (moved from page.tsx so it recomputes on toggle) ----------

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
        gap: 4,
        padding: "14px 0 4px",
      }}
    >
      {showSub && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Subtotal {centsToDisplay(subtotalCents)}
        </div>
      )}
      {discBps > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Discount {disc}% −{centsToDisplay(discountCents)}
        </div>
      )}
      {taxBps > 0 && (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Tax {tax}% +{centsToDisplay(taxCents)}
        </div>
      )}
      <div style={{ fontWeight: 900, fontSize: 19 }}>
        Total {centsToDisplay(totalCents)}
      </div>
      {dep > 0 && (
        <div className="muted" style={{ fontSize: 12 }}>
          {centsToDisplay(depositCents)} deposit due today &middot; the rest when the job&rsquo;s done
        </div>
      )}
    </div>
  );
}

// ---- island -----------------------------------------------------------------

export function QuoteLines({
  fixedSubtotalCents,
  optionalLines,
  discBps,
  taxBps,
  depBps,
  token,
  changeAlreadyRequested,
}: QuoteLinesProps) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  function toggle(id: string, on: boolean): void {
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
      {/* Optional add-ons — customer toggles what to include */}
      {optionalLines.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 11, marginTop: 12, marginBottom: 4 }}>
            Optional add-ons &mdash; tap to include
          </div>
          {optionalLines.map((line) => {
            const amount = lineAmountCents(line.quantity, line.rateCents);
            return (
              <label key={line.id} className="addonrow">
                <input
                  type="checkbox"
                  checked={selectedIds.has(line.id)}
                  onChange={(e) => toggle(line.id, e.target.checked)}
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
      )}

      {/* Totals — recompute on every toggle */}
      <TotalsBlock
        subtotalCents={totals.subtotalCents}
        discountCents={totals.discountCents}
        taxCents={totals.taxCents}
        totalCents={totals.totalCents}
        depositCents={totals.depositCents}
        discBps={discBps}
        taxBps={taxBps}
        depBps={depBps}
      />

      {/* Approve / decline / request-change */}
      <QuoteActions
        token={token}
        totalCents={totals.totalCents}
        changeAlreadyRequested={changeAlreadyRequested}
        selectedLineIds={[...selectedIds]}
      />
    </>
  );
}
