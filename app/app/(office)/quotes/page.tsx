/**
 * /quotes — the quotes LEDGER, a sub-page of Customers (navsub, like Tasks).
 * This route spent a year as a redirect to the board; the board keeps today's moves, this page
 * is the book of paper it never showed — see features/quotes/quotes-ledger.
 */

"use client";

import { QuotesLedger } from "@/features/quotes/quotes-ledger";

export default function QuotesPage() {
  return <QuotesLedger />;
}
