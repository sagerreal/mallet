/**
 * lib/store/invoice-balance.ts
 * ONE rule, ONE definition for "how much of this invoice is paid, and what is still owed" —
 * the same pattern as lib/store/visit-placement.ts.
 *
 * This math had five hand-copied implementations (money-derive, lib/estimates, the tech
 * job modal's helpers, the close-out sheet, the customer invoice modal). Two of them had
 * learned that a LIST row carries no payment history; three had not, so the same invoice
 * read as fully unpaid in the field and correctly part-paid in the office — and the field
 * close-out card flipped between the two as the hydrator refetched. Every copy now
 * delegates here.
 *
 * Units: DOLLARS, like every money field on the store Invoice.
 */

import type { Invoice } from "./types";

/**
 * Everything already paid on this invoice, deposit included.
 *
 * A record built from a LIST/summary row carries no `payments` — the endpoint does not send
 * them — but the server already computed the balance, so `paidTotal` holds its answer and is
 * preferred. Without that, every ledger row would read as fully unpaid.
 */
export function invPaid(i: Invoice): number {
  if (i.paidTotal !== undefined) return i.paidTotal;
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/**
 * What is still owed — total − deposit − payments, floored at 0.
 *
 * On a SUMMARY row (`partial: true`) the server's own `due` wins outright. Re-deriving the
 * balance from parts that the list DTO does not carry (`depPaid` is 0, `payments` is empty)
 * reports the full tax-inclusive total as owed even when the customer already paid a deposit
 * — so the same job's done card read "$185 due" from the hydrator and "$85 due" from a
 * mutation reconcile, alternating on every refetch. The server figure is the honest one, and
 * it is carried as the balance rather than smuggled into `depPaid`, which would make the
 * deposit line lie about money that was never a deposit.
 */
export function invDue(i: Invoice): number {
  if (i.partial && i.due !== undefined) return Math.max(0, i.due);
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}
