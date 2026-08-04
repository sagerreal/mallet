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
 * the status line and the QUIET peers only. A small Reopen affordance sits
 * above the card.
 */

"use client";

import { memo } from "react";
import type { Invoice, Job, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { invDue, jobTotal } from "./helpers";

export interface DoneBlockProps {
  job: Job;
  lead: Lead | undefined;
  invoice: Invoice | undefined;
  onOpenCloseOut: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onChargeOnFile: () => void;
  onSendToOffice: () => void;
  onReopen: () => void;
  /**
   * Is there a visit Reopen can actually move?
   *
   * Reopen writes a VISIT status. A job completed straight from My Day can have no PLACED visit
   * at all (the field only ever shows placed ones), and then the handler had nothing to call —
   * the button rendered, took the tap and did nothing. False hides it: a control that cannot
   * act must not be on screen.
   */
  canReopen: boolean;
}

// DoneBlock uses a custom comparator — it only reads job.invRequested and job.lines
// (via jobTotal), neither of which changes on a checklist tap.
export function doneBlockPropsEqual(a: DoneBlockProps, b: DoneBlockProps): boolean {
  return (
    a.onOpenCloseOut === b.onOpenCloseOut &&
    a.onOpenInvoice === b.onOpenInvoice &&
    a.onChargeOnFile === b.onChargeOnFile &&
    a.onSendToOffice === b.onSendToOffice &&
    a.onReopen === b.onReopen &&
    a.canReopen === b.canReopen &&
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
   * The org's configured visit fee, dollars — read outside the store on this surface (the
   * field shell never hydrates settings; see features/settings/use-org-service-fee.ts).
   * 0/unset hides the button below: never a $0 fee collection.
   */
  feeAmount: number;
  /** A fee invoice already exists for this job — hides the button (never collect it twice). */
  hasFeeInvoice: boolean;
  /** Creates + sends the fee invoice and opens the close-out sheet to collect it on site. */
  onCollectFee: () => void;
  /** Surfaced when the fee-collect write fails (setJobLines/addInvoice rejected). */
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
  feeAmount,
  hasFeeInvoice,
  onCollectFee,
  feeError,
}: ScopeHandoffBlockProps) {
  const showFeeButton = feeAmount > 0 && !hasFeeInvoice;

  const feeControls = (
    <>
      {showFeeButton ? (
        <button className="tjpaid-btn2" onClick={onCollectFee}>
          Collect the visit fee — {fmt$(feeAmount)}
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
 * Which terminal action the modal's sticky .sheet-foot carries for a done job
 * (office view). Mirrors the branch order of DoneBlockFn below — the two must
 * stay in lockstep. Null = the job is settled or already with the office; the
 * foot falls back to plain Done.
 */
export function doneFootAction(
  job: Job,
  lead: Lead | undefined,
  invoice: Invoice | undefined,
): DoneFootKind | null {
  if (invoice && (invoice.total ?? 0) > 0 && invDue(invoice) <= 0) return null;
  if (job.invRequested) return null;
  const due = invoice ? invDue(invoice) : jobTotal(job);
  if (due > 0) return lead?.card ? "charge" : "collect";
  return "sendoffice";
}

function DoneBlockFn({
  job,
  lead,
  invoice,
  onOpenCloseOut,
  onOpenInvoice,
  onSendToOffice,
  onReopen,
  canReopen,
}: DoneBlockProps) {
  // a draft invoice may already exist (opened pay then backed out) — that must
  // NOT remove the send-to-office option; due is read off it when present.
  const due = invoice ? invDue(invoice) : jobTotal(job);
  const card = lead?.card ?? null;

  // Absent when there is no placed visit to move — see canReopen.
  const reopen = canReopen ? (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "var(--space-4) 0 0" }}>
      <button className="btn sm ghost" onClick={onReopen}>
        ↩ Reopen
      </button>
    </div>
  ) : null;

  // Paid — a priced invoice fully settled.
  if (invoice && (invoice.total ?? 0) > 0 && invDue(invoice) <= 0) {
    return (
      <>
        {reopen}
        <div className="tjpaid ok">
          <div className="tjpaid-top">
            <b>✓ Paid · {fmt$(invoice.total ?? 0)}</b>
          </div>
          <div className="tjpaid-sub">
            <span className="linklike" onClick={() => onOpenInvoice(invoice.id)}>
              receipt &amp; invoice
            </span>
          </div>
        </div>
      </>
    );
  }

  // Handed to the office to bill.
  if (job.invRequested) {
    return (
      <>
        {reopen}
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
      </>
    );
  }

  // Due + card on file — the CHARGE lives in the sheet foot; quiet peers here.
  if (due > 0 && card) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
            Take payment another way →
          </button>
          <button className="tjpaid-btn2" onClick={onSendToOffice}>
            Send to the office to bill
          </button>
        </div>
      </>
    );
  }

  // Due, no card — "Take payment" lives in the sheet foot; hand-off stays here.
  if (due > 0) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn2" onClick={onSendToOffice}>
            Send to the office to bill
          </button>
        </div>
      </>
    );
  }

  // No price yet — "Send to the office" lives in the sheet foot; the set-a-bill
  // alternative stays here (opening close-out can set a bill).
  return (
    <>
      {reopen}
      <div className="tjpaid">
        <div className="tjpaid-top">
          <b>✓ Job done</b>
        </div>
        <div className="tjpaid-sub" style={{ marginBottom: "var(--space-2)" }}>
          No price set — the office invoices it.
        </div>
        <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
          Set a bill &amp; take payment →
        </button>
      </div>
    </>
  );
}
export const DoneBlock = memo(DoneBlockFn, doneBlockPropsEqual);
