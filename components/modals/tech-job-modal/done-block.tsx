/**
 * components/modals/tech-job-modal/done-block.tsx
 * On-site close-out HERO (prototype techDoneBlock, 5698-5760) — the "job done →
 * get paid on site" block, shown when the job is done. Branches on the invoice /
 * due / card-on-file (mirrors the prototype's non-install path; the
 * install-specific split is deferred). "Take payment" opens the CLOSE_OUT modal;
 * charge-on-file records straight through recordPayment; send-to-office flags
 * invRequested. A small Reopen affordance sits above the card.
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
    a.lead === b.lead &&
    a.invoice === b.invoice &&
    a.job.invRequested === b.job.invRequested &&
    a.job.lines === b.job.lines
  );
}

function DoneBlockFn({
  job,
  lead,
  invoice,
  onOpenCloseOut,
  onOpenInvoice,
  onChargeOnFile,
  onSendToOffice,
  onReopen,
}: DoneBlockProps) {
  // a draft invoice may already exist (opened pay then backed out) — that must
  // NOT remove the send-to-office option; due is read off it when present.
  const due = invoice ? invDue(invoice) : jobTotal(job);
  const card = lead?.card ?? null;

  const reopen = (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "var(--space-4) 0 0" }}>
      <button className="btn sm ghost" onClick={onReopen}>
        ↩ Reopen
      </button>
    </div>
  );

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

  // Due + card on file — charge it, take another way, or hand to the office.
  if (due > 0 && card) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn" onClick={onChargeOnFile}>
            Charge {fmt$(due)} to {card.brand} ···· {card.last4}
          </button>
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

  // Due, no card — take payment, or hand to the office.
  if (due > 0) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn" onClick={onOpenCloseOut}>
            Take payment →
          </button>
          <button className="tjpaid-btn2" onClick={onSendToOffice}>
            Send to the office to bill
          </button>
        </div>
      </>
    );
  }

  // No price yet — the office invoices it (opening close-out can set a bill).
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
        <button className="tjpaid-btn" onClick={onSendToOffice}>
          Send to the office to bill
        </button>
        <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
          Set a bill &amp; take payment →
        </button>
      </div>
    </>
  );
}
export const DoneBlock = memo(DoneBlockFn, doneBlockPropsEqual);
