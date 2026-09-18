/**
 * components/modals/money-pointer.tsx
 * The office job modal's ONE anchored money pointer (prototype moneyPointer,
 * line 6379) — never the P&L. Opens the invoice if a priced one exists,
 * otherwise offers "Create the invoice →" once the work is done.
 *
 * An UNPRICED ESTIMATE renders nothing: a scoping visit has no money to point
 * at, and the old pointer minted a meaningless $0 draft. Signed-on-site
 * estimates carry priced lines (isUnpricedEstimate is false) and stay billable.
 */

"use client";

import type { Invoice, Job } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { invDue, isUnpricedEstimate } from "./tech-job-modal/helpers";

export interface MoneyPointerProps {
  job: Job;
  invoice: Invoice | undefined;
  /** Creates the invoice and opens it. Disabled while the request is in flight. */
  onBill: () => void;
  billing: boolean;
  billError: string | null;
  onOpenInvoice: (invoiceId: string) => void;
}

export function MoneyPointer({ job, invoice, onBill, billing, billError, onOpenInvoice }: MoneyPointerProps) {
  if (invoice && (invoice.total ?? 0) > 0) {
    const due = invDue(invoice);
    return (
      <div className="jmoney">
        <span>{due > 0 ? `${invoice.num} — ${fmt$(due)} due` : `✓ ${invoice.num} paid in full`}</span>
        <span className="linklike" onClick={() => onOpenInvoice(invoice.id)}>
          open invoice →
        </span>
      </div>
    );
  }

  // A done, unpriced ESTIMATE is a finished scoping visit — the next step is a
  // quote (pipeline Quoting lane), not an invoice. No pointer.
  if (isUnpricedEstimate(job)) return null;

  if (job.status === "done") {
    // BILLS IT, rather than pointing at where billing happens. This modal is opened FROM the Money
    // ledger's "ready to bill" rows, so "Bill it in Money →" navigated the user to the page they
    // had just come from — a link whose only effect was to close the thing they were reading.
    return (
      <div className="jmoney">
        <span>{billError ? billError : "✓ Work done — not billed yet"}</span>
        <button type="button" className="linklike" onClick={onBill} disabled={billing}>
          {billing ? "Creating invoice…" : "Create the invoice →"}
        </button>
      </div>
    );
  }

  return null;
}
