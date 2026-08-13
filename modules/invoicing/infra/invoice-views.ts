import { and, eq, gt, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { invoices } from "@mallet/shared/db/schema";

/**
 * The Money ledger's status bands, in SQL — the twin of `invStatusKey` in features/money/money-derive.ts.
 *
 * The screen offered a Status filter that ran in the browser over the rows already loaded, so on a
 * shop with 847 invoices "show me the overdue ones" filtered the newest page and reported whatever
 * happened to be in it. Filtering has to happen where the rows are.
 *
 * ORDER MATTERS and mirrors the client function exactly, because the bands are a priority list
 * rather than independent predicates: a draft is a draft even if old, an overdue invoice is
 * reported as overdue rather than as part-paid, and anything with nothing left owing is paid.
 * Written here as mutually exclusive conditions so the counts sum to the ledger.
 *
 * `over` is not a column. It is "past the date this customer agreed to pay by, and still owed" —
 * which is why it needs a predicate over dueAt and the balance, not a status lookup.
 */
export const INVOICE_VIEWS = ["draft", "over", "paid", "partial", "sent"] as const;
export type InvoiceView = (typeof INVOICE_VIEWS)[number];

/** Still owed: the total minus the deposit minus payments received. Floored at zero, like the client. */
const balanceOwed: SQL<number> = sql<number>`greatest(0, ${invoices.totalCents} - ${invoices.depositPaidCents} - ${invoices.amountPaidCents})`;

/** Past its due date. Null dueAt is NOT overdue — nothing was promised, so nothing was missed. */
const pastDue: SQL = and(isNotNull(invoices.dueAt), lt(invoices.dueAt, sql`now()`)) as SQL;

/** Anything owing at all — the difference between "sent" and "paid" regardless of status text. */
const owing: SQL = gt(balanceOwed, sql`0`) as SQL;

const notDraft: SQL = ne(invoices.status, "draft") as SQL;

/**
 * VOIDED invoices are not a band — they are the archive.
 *
 * A void invoice keeps its total and its due date, so `owing` and `pastDue` both read true on one
 * and it landed in `over`: a cancelled bill counted as money a customer owes you, and chased as
 * overdue. One such row exists in the shared database today, so nothing live is wrong yet, but the
 * rule was. Every band now excludes it and the Money screen's Archived tab is where it shows.
 */
const notVoid: SQL = ne(invoices.status, "void") as SQL;

/**
 * The bands as raw predicates, for the ledger SORT to rank by.
 *
 * Exported so that the order rows appear in and the filter that selects them are built from ONE
 * definition. They were separate before, and had already drifted: the sort called an invoice
 * overdue only when its status was literally 'sent', so an overdue part-payment sorted as though
 * it were merely part-paid while the screen showed it with an Overdue pill.
 */
export const INVOICE_BANDS = { pastDue, owing, notDraft, notVoid } as const;

export const invoiceViewCondition = (view: InvoiceView): SQL => {
  switch (view) {
    case "draft":
      // A status cannot be both, so this needs no void guard.
      return eq(invoices.status, "draft") as SQL;
    case "over":
      // Sent (or part-paid), past due, still owed. Checked BEFORE partial and sent, exactly as the
      // client checks it — an overdue part-payment is chased as overdue, not filed under partial.
      return and(notDraft, notVoid, owing, pastDue) as SQL;
    case "paid":
      // Nothing left owing. Not `status = 'paid'`: an invoice settled by a payment that closed the
      // balance reads as paid to the shop whatever its status column says.
      return and(notDraft, notVoid, sql`NOT ${owing}`) as SQL;
    case "partial":
      return and(notDraft, notVoid, owing, sql`NOT ${pastDue}`, gt(invoices.amountPaidCents, 0)) as SQL;
    case "sent":
    default:
      // What is left: sent, not yet due, nothing paid against it.
      // amount_paid_cents is NOT NULL DEFAULT 0, so zero is the whole "nothing paid" case.
      return and(notDraft, notVoid, owing, sql`NOT ${pastDue}`, eq(invoices.amountPaidCents, 0)) as SQL;
  }
};
