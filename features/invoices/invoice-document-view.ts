/**
 * features/invoices/invoice-document-view.ts
 *
 * The store's Invoice → the shared <InvoiceDocument>'s props. THE one place a store invoice
 * becomes a customer-facing document, and the one place its DOLLARS become the document's CENTS.
 *
 * Why it exists at all: the store holds money in dollars (lib/store/dto-mapper.ts is where cents
 * become dollars), the document renders cents, and two surfaces — the office's "Preview as
 * customer" and the technician's close-out — both need the crossing. Written twice it drifts;
 * written here it is one function with one rounding rule.
 *
 * No React, no JSX — pure and unit-testable, same shape as terms-line.ts beside it.
 */

import type { Invoice } from "@/lib/store/types";
import { invDue, invPaid } from "@/lib/store/invoice-balance";
import type { InvoiceDocumentLine } from "@/components/shared/invoice-document";
import { termsLine } from "./terms-line";

/**
 * Dollars → integer cents. Rounded, never truncated: 89.5 * 100 is 8949.999… in binary floating
 * point, and a truncating cast would bill $89.49.
 */
const toCents = (dollars: number | null | undefined): number => Math.round((dollars ?? 0) * 100);

/** The money + meta half of the document. `title` and `num` stay with the caller — see below. */
export interface InvoiceDocumentView {
  readonly termsFace: string;
  readonly lines: readonly InvoiceDocumentLine[];
  readonly totalCents: number;
  readonly taxCents: number;
  readonly depositPaidCents: number;
  readonly amountPaidCents: number;
  readonly balanceDueCents: number | null;
}

/**
 * Build the document view for a store invoice.
 *
 * `title` is deliberately NOT produced here. Every surface already names the work in its own
 * chrome (the preview's "thanks for having us out for your {job}", the close-out's sheet head),
 * and only the public page wants it repeated inside the document — so the caller passes it.
 *
 * Net terms and the due date are dropped once the bill is SETTLED, matching the public page: a
 * due date on a receipt is noise. The PO number is a permanent reference and survives regardless,
 * which is termsLine's own rule.
 */
export function invoiceDocumentView(invoice: Invoice): InvoiceDocumentView {
  const settled = invoice.status === "paid" || invoice.status === "void";
  const isVoid = invoice.status === "void";

  return {
    termsFace: termsLine({
      termsDays: settled ? 0 : invoice.termsDays,
      dueAt: settled ? null : invoice.dueAt,
      poNumber: invoice.poNumber,
    }),
    lines: (invoice.lines ?? []).map((line) => ({
      description: line.d,
      quantity: line.q ?? 1,
      amountCents: toCents((line.q ?? 1) * (line.r ?? 0)),
    })),
    // Tax-INCLUSIVE, straight off the record — never a re-sum of `lines`. An invoice raised from
    // a quote carries the agreed total with no lines at all.
    totalCents: toCents(invoice.total),
    taxCents: toCents(invoice.tax),
    depositPaidCents: toCents(invoice.depPaid),
    amountPaidCents: toCents(invPaid(invoice)),
    // A canceled bill owes nothing, so it states no balance at all (see InvoiceDocumentProps).
    balanceDueCents: isVoid ? null : toCents(invDue(invoice)),
  };
}
