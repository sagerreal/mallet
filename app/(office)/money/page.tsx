"use client";

/**
 * Money page — one surface: the money ledger (features/money/money-ledger).
 * The old dashboard/invoices split is gone; every stage of getting paid is a
 * row in one table, and the stat tiles are filters on it. The ?tab= param is
 * ignored (old links land here correctly).
 */

import { MoneyLedger } from "@/features/money/money-ledger";

export default function MoneyPage() {
  return (
    <div>
      <MoneyLedger />
    </div>
  );
}
