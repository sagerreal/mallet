/**
 * components/modals/tech-job-modal/done-block.tsx
 * On-site close-out card (prototype techDoneBlock, 5698-5760) — the "job done →
 * get paid on site" block, shown when the job is done. Branches on the invoice /
 * due / card-on-file (mirrors the prototype's non-install path; the
 * install-specific split is deferred).
 *
 * Sheet grammar: the SINGLE terminal action of each branch (charge on file /
 * take payment / send to the office) is rendered by the modal's sticky
 * .sheet-foot as the .sheet-pri — see doneFootAction below. This card carries
 * the status line and the QUIET peers only. Reopen is NOT here: it writes a
 * VISIT status, so it lives once, in the "Your visit(s)" section beside the visit
 * it moves — the same single home the not-done VisitRow uses.
 *
 * WHERE THE OFFICE HAND-OFF LIVES. Not in this card, on any branch that owes money.
 * "Send to the office to bill" used to sit inside the "✓ Job done · $185" hero, one
 * screen before the close-out — which already offers "Take payment — $185" and
 * "Log & send to office →" side by side. The hero was making the technician pick a
 * route before showing him the screen that has both, and on the no-card branch it
 * contradicted its own foot, which said "Take payment →". On a job with money owed the
 * card now offers taking the money and nothing else; the hand-off is one tap away on the
 * close-out. It remains the foot primary in the one state where there is no money to
 * take — a genuinely unpriced job (doneFootAction's "sendoffice").
 */

"use client";

import { memo } from "react";
import type { Invoice, Job, Lead } from "@/lib/store/types";
// fmt$2, never fmt$: this block states the balance the technician is about to collect, and the
// close-out it opens prints the same balance to the cent. Rounded, the two disagreed.
import { fmt$2 } from "@/lib/format";
import { invDue, jobTotal, pricesHidden } from "./helpers";

export interface DoneBlockProps {
  job: Job;
  lead: Lead | undefined;
  invoice: Invoice | undefined;
  onOpenCloseOut: () => void;
  /**
   * Opens the office invoice modal on the settled bill. OPTIONAL: that modal reads
   * `v1.invoicing.get` — the unredacted office record, with line cost and the customer's
   * pay-link token on it — so a field caller passes nothing and the receipt link is not drawn.
   */
  onOpenInvoice?: (invoiceId: string) => void;
  onChargeOnFile: () => void;
  /**
   * May price the bill on site — the close-out's BillAsk commits through `v1.jobs.setLines` and
   * `v1.invoicing.patchLines`, both ownerOrOffice and both bulk REPLACES, so neither was widened.
   * False hides "Set a bill & take payment", which would otherwise open a sheet with no builder.
   */
  canSetBill?: boolean;
  /**
   * The last charge-on-file refusal, verbatim (Stripe's own decline sentence), shown on the
   * due+card branch — the card the foot's Charge button belongs to. Null between attempts.
   */
  chargeError?: string | null;
}

// DoneBlock uses a custom comparator — it only reads job.invRequested and job.lines
// (via jobTotal), neither of which changes on a checklist tap.
export function doneBlockPropsEqual(a: DoneBlockProps, b: DoneBlockProps): boolean {
  return (
    a.onOpenCloseOut === b.onOpenCloseOut &&
    a.onOpenInvoice === b.onOpenInvoice &&
    a.onChargeOnFile === b.onChargeOnFile &&
    a.canSetBill === b.canSetBill &&
    a.chargeError === b.chargeError &&
    a.lead === b.lead &&
    a.invoice === b.invoice &&
    a.job.invRequested === b.job.invRequested &&
    a.job.lines === b.job.lines
  );
}

export type DoneFootKind = "charge" | "collect" | "sendoffice";

export interface ScopeHandoffBlockProps {
  /** A visit on this job carries scope notes — the office handoff already happened. */
  scoped: boolean;
  /** Switches the modal to the Quote tab, where scope is captured and read. */
  onOpenQuoteTab: () => void;
  /**
   * This viewer may charge the fee: the office, or a technician assigned to this job. The write
   * itself (`v1.fieldInvoicing.raiseVisitFee`) is job-authorized server-side; this is only what
   * decides whether to draw a control that would be refused.
   */
  canCollectFee: boolean;
  /**
   * The org's configured visit fee in dollars, when THIS device could read it — the office can
   * (`v1.settings.get`), the field shell cannot (it is ownerOrOffice, and the field layout mounts
   * no SettingsHydrator). `null` means "this device doesn't know the number", and the button says
   * so by naming no amount; the server reads the real fee either way, which is exactly why the
   * amount was never an input.
   */
  feeAmount: number | null;
  /** A fee invoice already exists for this job — hides the button (never collect it twice). */
  hasFeeInvoice: boolean;
  /** Raises the fee invoice and opens the close-out sheet to collect it on site. */
  onCollectFee: () => void;
  /** Surfaced when the raise is refused (fee unset, visit not finished, connection). */
  feeError?: string | null;
}

/**
 * The done state for an UNPRICED ESTIMATE — a scoping visit. There is no money
 * on this job (see isUnpricedEstimate in helpers.ts), so the close-out is a
 * handoff, never a billing branch: the office builds the quote from the scope.
 * Rendered in DoneBlock's slot; the modal's foot stays a plain Done.
 *
 * A declined estimate still owes the org's visit/diagnostic fee — "Collect the visit fee" is
 * a SECONDARY action beside the handoff (never replaces it): tapping it bills + collects the
 * fee for THIS visit without asking the office to quote anything.
 */
export function ScopeHandoffBlock({
  scoped,
  onOpenQuoteTab,
  canCollectFee,
  feeAmount,
  hasFeeInvoice,
  onCollectFee,
  feeError,
}: ScopeHandoffBlockProps) {
  const showFeeButton = canCollectFee && !hasFeeInvoice;

  const feeControls = (
    <>
      {showFeeButton ? (
        <button className="tjpaid-btn2" onClick={onCollectFee}>
          {feeAmount ? `Collect the visit fee — ${fmt$2(feeAmount)}` : "Collect the visit fee →"}
        </button>
      ) : null}
      {feeError ? (
        <div className="tjpaid-sub" style={{ color: "var(--red)" }}>
          {feeError}
        </div>
      ) : null}
    </>
  );

  if (scoped) {
    return (
      <div className="tjpaid ok">
        <div className="tjpaid-top">
          <b>✓ Scoped — the office builds the quote</b>
        </div>
        {feeControls}
      </div>
    );
  }
  return (
    <div className="tjpaid">
      <div className="tjpaid-top">
        <b>✓ Estimate visit done</b>
      </div>
      <div className="tjpaid-sub" style={{ marginBottom: "var(--space-2)" }}>
        No scope captured — the office has nothing to quote from.
      </div>
      <button className="tjpaid-btn2" onClick={onOpenQuoteTab}>
        Open the Quote tab →
      </button>
      {feeControls}
    </div>
  );
}

/**
 * Which terminal action the modal's sticky .sheet-foot carries for a done job.
 * Mirrors the branch order of DoneBlockFn below — the two must stay in lockstep.
 * Null = the job is settled, already with the office, or has nothing this viewer
 * can do about it; the foot falls back to plain Done.
 *
 * `canSendToOffice` gates ONLY the "sendoffice" kind — the genuinely-unpriced job, where the
 * hand-off is the sole terminal action because there is nothing to collect. It defaults true:
 * the office is the original caller. Every branch that owes money returns charge/collect, so on
 * a done job with a balance the foot and the card now say the same thing — take the money.
 */
export function doneFootAction(
  job: Job,
  lead: Lead | undefined,
  invoice: Invoice | undefined,
  canSendToOffice = true,
): DoneFootKind | null {
  if (invoice && (invoice.total ?? 0) > 0 && invDue(invoice) <= 0) return null;
  if (job.invRequested) return null;
  const due = invoice ? invDue(invoice) : jobTotal(job);
  if (due > 0) return lead?.card ? "charge" : "collect";
  // Zero visible money, and the reason decides the answer. With no invoice loaded yet, a job whose
  // rates this device may not see sums to zero without being free — the bill exists, the balance
  // is on it, and the close-out reads the real figure off the invoice. Routing that to "Send to
  // the office to bill" is the single most damaging way this screen can be wrong: it tells a
  // technician standing at the door that there is nothing to collect.
  if (!invoice && pricesHidden(job)) return "collect";
  // Genuinely unpriced. The hand-off is an office write; a viewer without it has no terminal
  // action here at all, and a plain Done is the honest foot.
  return canSendToOffice ? "sendoffice" : null;
}

function DoneBlockFn({
  job,
  lead,
  invoice,
  onOpenCloseOut,
  onOpenInvoice,
  canSetBill = true,
  chargeError = null,
}: DoneBlockProps) {
  // a draft invoice may already exist (opened pay then backed out) — that must
  // NOT remove the send-to-office option; due is read off it when present.
  const due = invoice ? invDue(invoice) : jobTotal(job);
  const card = lead?.card ?? null;

  // Paid — a priced invoice fully settled.
  if (invoice && (invoice.total ?? 0) > 0 && invDue(invoice) <= 0) {
    return (
      <div className="tjpaid ok">
        <div className="tjpaid-top">
          <b>✓ Paid · {fmt$2(invoice.total ?? 0)}</b>
        </div>
        {onOpenInvoice ? (
          <div className="tjpaid-sub">
            <span className="linklike" onClick={() => onOpenInvoice(invoice.id)}>
              receipt &amp; invoice
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  // Handed to the office to bill.
  if (job.invRequested) {
    return (
      <div className="tjpaid ok">
        <div className="tjpaid-top">
          <b>✓ Sent to the office</b>
        </div>
        <div className="tjpaid-sub">
          The office texts the customer a pay link ·{" "}
          <span className="linklike" onClick={onOpenCloseOut}>
            take payment instead
          </span>
        </div>
      </div>
    );
  }

  // Due + card on file — the CHARGE lives in the sheet foot; the one quiet peer here is the
  // OTHER way to get paid, not another route out of getting paid.
  //
  // LIVE FOR AN ASSIGNED TECHNICIAN since the card-on-file build: the field customer DTO now
  // carries the PRESENTATIONAL card facts (brand/last4/via — modules/jobs/api/field-router.ts),
  // and the foot's charge runs `v1.fieldInvoicing.chargeOnFile` — a REAL Stripe charge,
  // assignment-gated server-side, full balance, never a caller amount. `chargeError` is the
  // decline surface: Stripe's own sentence, shown where the button was tapped (the old silent
  // fire-and-forget rollback is exactly what a card refusal must never be).
  if (due > 0 && card) {
    return (
      <div className="tjpaid">
        <div className="tjpaid-top">
          <b>✓ Job done</b>
          <span className="tjpaid-amt fig">{fmt$2(due)}</span>
        </div>
        {chargeError ? (
          <div className="tjpaid-sub" role="alert" style={{ color: "var(--red)" }}>
            {chargeError}
          </div>
        ) : null}
        <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
          Take payment another way →
        </button>
      </div>
    );
  }

  // Due, no card — the hero is the STATUS LINE ONLY. "Take payment →" is the foot primary
  // (doneFootAction returns "collect" for exactly this state), and the close-out it opens
  // offers "Take payment — $x" and "Log & send to office →" side by side. A second peer here
  // would either repeat the foot or, as it did, ask the technician to choose between paid-now
  // and the office one screen BEFORE the screen that offers both.
  if (due > 0) {
    return (
      <div className="tjpaid">
        <div className="tjpaid-top">
          <b>✓ Job done</b>
          <span className="tjpaid-amt fig">{fmt$2(due)}</span>
        </div>
      </div>
    );
  }

  // Nothing visible to collect — and WHY decides everything. See NoVisibleMoneyCard.
  return (
    <NoVisibleMoneyCard
      hidden={!invoice && pricesHidden(job)}
      canSetBill={canSetBill}
      onOpenCloseOut={onOpenCloseOut}
    />
  );
}

/**
 * The done card when this device sees no money on the job. Two reasons, two different sentences,
 * and telling a technician the wrong one is how this screen lies: "No price set" on a job whose
 * prices the shop hid from him is false, and it is the sentence that would send him away from a
 * bill the customer is standing there to pay.
 */
function NoVisibleMoneyCard({
  hidden,
  canSetBill,
  onOpenCloseOut,
}: {
  hidden: boolean;
  canSetBill: boolean;
  onOpenCloseOut: () => void;
}) {
  return (
    <div className="tjpaid">
      <div className="tjpaid-top">
        <b>✓ Job done</b>
      </div>
      <div className="tjpaid-sub" style={{ marginBottom: "var(--space-2)" }}>
        {hidden
          ? "Prices are hidden on your device — open the bill to see what’s due."
          : "No price set — the office invoices it."}
      </div>
      {hidden || canSetBill ? (
        <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
          {hidden ? "Open the bill & take payment →" : "Set a bill & take payment →"}
        </button>
      ) : null}
    </div>
  );
}
export const DoneBlock = memo(DoneBlockFn, doneBlockPropsEqual);
