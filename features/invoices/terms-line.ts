/**
 * features/invoices/terms-line.ts
 * The ONE line an invoice's face carries for money-flow terms: "Net 30 · due Sep 2 · PO 4471".
 * Single source of truth for all three invoice-facing surfaces — the office sheet
 * (invoice-modal.tsx), the customer preview (cust-invoice-modal.tsx), and the public pay page
 * (app/(public)/i/[token]/page.tsx). No React, no store — unit-testable, pure.
 *
 * Rules:
 *   - "Net {termsDays}" appears only when termsDays > 0 (on-receipt, termsDays === 0, says
 *     nothing — there is no term to name).
 *   - "due {date}" appears whenever a due date is present, REGARDLESS of termsDays — an invoice
 *     always states its due date once sent, even an on-receipt one.
 *   - "PO {poNumber}" appears whenever the customer supplied one.
 *   - Segments join with " · ", in that order. No segments → empty string (a draft, on-receipt,
 *     unsent invoice with no PO has nothing to say here).
 */

import { formatDate } from "@/lib/format";

export interface TermsLineInput {
  /** Net payment terms in days. 0 (or absent) means "due on receipt" — omitted from the line. */
  termsDays: number | null | undefined;
  /** ISO due date, present once the invoice has been sent. Null/undefined before send. */
  dueAt: string | null | undefined;
  /** Customer-supplied purchase order number, if any. */
  poNumber: string | null | undefined;
}

export function termsLine({ termsDays, dueAt, poNumber }: TermsLineInput): string {
  const segments: string[] = [];

  if (termsDays != null && termsDays > 0) {
    segments.push(`Net ${termsDays}`);
  }
  if (dueAt) {
    segments.push(`due ${formatDate(dueAt)}`);
  }
  if (poNumber && poNumber.trim() !== "") {
    segments.push(`PO ${poNumber}`);
  }

  return segments.join(" · ");
}
