/**
 * components/modals/tech-job-modal/work-order-sec.tsx
 * The work order: what was sold, itemised, with a count and a Total.
 *
 * "WORK ORDER · 4 items · $730.00" is not a money-rule violation. The rule (see job-modal.tsx) is
 * that this surface shows the PRICE THE OFFICE SET — line items and a total — and never cost,
 * margin, profit or P&L. Line COST is not rendered here under any condition, for any role.
 *
 * MONEY HAS THREE STATES HERE, NOT TWO. `redactMoneyForTech` nulls every line rate when the org's
 * `techSeesPrice` is off, so a naive sum of a genuinely priced job returns 0 and would print a
 * fabricated "$0" at a technician standing on a doorstep. The three:
 *
 *   1. figures visible          → "4 items · $730.00" and a Total row
 *   2. genuinely free / unset   → "4 items · $0.00" and a Total row reading $0.00
 *   3. withheld from this device→ "4 items", no Total, and one plain sentence saying so
 *
 * `pricesHidden` (a null rate = the redaction signal, never a real zero) is what separates 3 from
 * 2, and getting that wrong is documented in done-block.tsx as the most damaging failure this
 * screen can produce. `seesPrice` — the store's own copy of the org toggle — is asked alongside
 * it so a device that has the flag but not the redaction still shows no figures.
 *
 * The count and the total are computed over exactly the lines this section RENDERS, so the header
 * always adds up to what is beneath it.
 *
 * THE TOTAL IS THE BILLED TOTAL. When the job stores a discount or sales-tax rate (`job.pricing`
 * — the same pair the price sheet edits), the plain Total row becomes the field builder's
 * Subtotal → Discount → Sales tax → Total breakdown, derived through the one money chain
 * (lib/store/job-pricing.ts). The raw line sum here once disagreed with the invoice by exactly
 * the tax, on the sheet a technician reads out at the customer's door.
 */

"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import type { Job } from "@/lib/store/types";
import { fmt$2 } from "@/lib/format";
import { jobHasPricing, jobPricingRates, jobPricedTotals } from "@/lib/store/job-pricing";
import { PriceBreakdown } from "@/components/modals/pricing/field-pricing";
import { pricesHidden } from "./helpers";

const SCOPE_HEAD: CSSProperties = {
  fontSize: "var(--type-xs)",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

const LINE_ROW: CSSProperties = {
  fontSize: "var(--type-base)",
  padding: "var(--space-1) 0",
  display: "flex",
  gap: "var(--space-2)",
  alignItems: "baseline",
};

const TOTAL_ROW: CSSProperties = {
  ...LINE_ROW,
  borderTop: "1px solid var(--line)",
  marginTop: "var(--space-2)",
  paddingTop: "var(--space-2)",
  fontWeight: 800,
};

export interface WorkOrderSecProps {
  job: Job;
  seesPrice: boolean;
}

// Custom comparator for the memoized section — compares only the job fields the
// section actually reads. A checklist tap changes job.verify: WorkOrderSec reads
// none of those fields, so it skips the re-render.
export function workOrderPropsEqual(a: WorkOrderSecProps, b: WorkOrderSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.job.lines === b.job.lines &&
    a.job.pricing === b.job.pricing &&
    a.job.photos === b.job.photos &&
    // job.title is deliberately NOT compared: this section stopped rendering it when the heading
    // and the sheet header were found to be saying the same thing three inches apart. A stale
    // field in a hand-written comparator is this directory's standing trap — it re-renders on a
    // change nothing here can show.
    a.job.special === b.job.special &&
    a.job.prep === b.job.prep
  );
}

// WorkOrderSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads lines/photos/title/special/prep.
function WorkOrderSecFn({ job, seesPrice }: WorkOrderSecProps) {
  const scope = (job.lines ?? []).filter((l) => (l.d ?? "").trim());
  const photoN = (job.photos ?? []).length;
  const hidden = pricesHidden(job);
  const showMoney = seesPrice && !hidden;
  // Summed over the RENDERED lines only, so "4 items · $730.00" and the Total row can never
  // disagree with the four numbers between them.
  const total = scope.reduce((sum, l) => sum + (l.q ?? 1) * (l.r ?? 0), 0);
  const items = `${scope.length} item${scope.length === 1 ? "" : "s"}`;
  // The job's stored discount/tax — the same rates the price sheet edits, run through the ONE
  // money chain the invoice bills. With either rate set, the plain Total row becomes the full
  // Subtotal → Discount → Sales tax → Total derivation (the field builder's own breakdown), and
  // the header carries the BILLED total: this section used to print the raw line sum while the
  // invoice billed line sum + tax — two totals for the same job, read out at the door.
  // Derived from the SAME `scope` lines the section renders, keeping the header honest.
  const rates = jobPricingRates(job);
  const priced = jobHasPricing(job);
  const totals = jobPricedTotals({ lines: scope, pricing: job.pricing });

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Work order</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
          {showMoney ? `${items} · ${priced ? fmt$2(totals.total / 100) : fmt$2(total)}` : items}
        </span>
      </div>
      {/* NO job title and NO "Scope — what was sold" subhead. The section head already says WORK
          ORDER and the sheet header already says which job this is; both were repeating what was
          two inches above them. The ✓ per line went with them — every line in a work order was
          sold, so a tick on all of them marks nothing. What is left is the list and its money. */}
      {scope.length ? (
        <>
          {scope.map((x, i) => (
            <div key={i} style={LINE_ROW}>
              <span style={{ flex: 1 }}>
                {x.d}
                {(x.q ?? 1) > 1 ? <span className="muted"> × {x.q}</span> : null}
              </span>
              {/* x.r === null = server-redacted (techSeesPrice off) — show nothing, never $0.
                  The amount is the line's other half, not an aside: same size as the description
                  and weighted, so the column reads as a column. */}
              {showMoney && x.r != null && (
                <span className="fig" style={{ fontWeight: 700 }}>{fmt$2((x.q ?? 1) * x.r)}</span>
              )}
            </div>
          ))}
          {showMoney && priced ? (
            // A rate is stored → the full derivation, cent-precise, matching the bill.
            <PriceBreakdown totals={totals} rates={rates} ruleColor="var(--line)" />
          ) : showMoney ? (
            <div style={TOTAL_ROW}>
              <span style={{ flex: 1 }}>Total</span>
              <span className="fig">{fmt$2(total)}</span>
            </div>
          ) : hidden ? (
            // State 3. One plain sentence, not a blank where a number should be — a technician
            // who cannot see a figure needs to know the figure exists.
            <div className="muted" style={{ fontSize: "var(--type-base)", paddingTop: "var(--space-2)" }}>
              Prices aren&rsquo;t shown on your device.
            </div>
          ) : null}
        </>
      ) : null}

      {job.special ? (
        <div
          style={{
            marginTop: "var(--space-3)",
            background: "#FFFBEF",
            border: "1px solid var(--manila-line)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
          }}
        >
          <b style={{ fontSize: "var(--type-sm)", color: "#b45309" }}>★ Homeowner&rsquo;s requests</b>
          <div style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2xs)" }}>{job.special}</div>
        </div>
      ) : null}

      {job.prep ? (
        <div style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2)" }}>
          <b>Bring:</b> {job.prep}
        </div>
      ) : null}

      {photoN ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <span className="muted" style={SCOPE_HEAD}>
            Site photos · {photoN}
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
            {Array.from({ length: Math.min(photoN, 4) }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--green-100)",
                  border: "1px solid var(--manila-line)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
export const WorkOrderSec = memo(WorkOrderSecFn, workOrderPropsEqual);
