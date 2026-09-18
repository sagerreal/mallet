"use client";

/**
 * Money page — the router shell for Money's two sub-views, split on `?tab=` exactly the way
 * app/(office)/jobs/page.tsx splits Jobs/Schedule/Timesheets. SectionTabs (the Money branch,
 * components/shell/section-tabs.tsx) drives which one is active:
 *   • MoneyLedger  — default, no ?tab=: the invoices ledger, exactly as before Purchase orders
 *                    existed — one row per invoice/ready-to-bill job (features/money/money-ledger).
 *                    There is no separate "Getting paid" tab of its own (Owen: just keep invoices
 *                    under Money).
 *   • OrdersPanel  — "Purchase orders" (?tab=orders): what the shop bought from a supplier, cash
 *                    going OUT (features/money/orders-panel). Kept as a separate set rather than
 *                    mixed into the receivables ledger — see orders-panel.tsx's file doc.
 * Any other/unknown ?tab= value falls through to the ledger (old links land here correctly, same
 * as this page did before Orders existed).
 */

import { useSearchParams } from "next/navigation";
import { MoneyLedger } from "@/features/money/money-ledger";
import { OrdersPanel } from "@/features/money/orders-panel";

export default function MoneyPage() {
  const tab = useSearchParams().get("tab");

  return <div>{tab === "orders" ? <OrdersPanel /> : <MoneyLedger />}</div>;
}
