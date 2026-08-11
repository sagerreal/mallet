/**
 * features/quotes/quotes-ledger-utils.ts
 * The quotes LEDGER's derivations — pure. What the book of paper says, before anything renders.
 *
 * The board's Quoting column answers "what is my move today"; this page answers "what paper is
 * out, what is it worth, what won and what died" — the question that had no surface once a quote
 * stopped being somebody's move. Declined quotes were simply invisible.
 *
 * VOCABULARY: the domain says accepted/declined; the trade says Won/Lost — the same words the
 * customer STAGE already uses, so the ledger and the stage chips never teach two dialects. A sent
 * quote whose customer asked for changes stays in the Sent bucket (it is still out the door) but
 * its pill says so — that is the row that needs the office's eye first.
 */

import type { Estimate, Lead } from "@/lib/store/types";
import { estTotal } from "@/lib/estimates";

export type QuoteBucket = "draft" | "sent" | "won" | "lost";
export type QuoteFilter = "all" | QuoteBucket;

/** Which bucket a quote files under, or null for paper the ledger does not show (trash). */
export function bucketOf(e: Estimate): QuoteBucket | null {
  if (e.trash) return null;
  if (e.status === "accepted") return "won";
  if (e.status === "declined") return "lost";
  if (e.status === "sent") return "sent";
  if (e.status === "draft") return "draft";
  return null;
}

export interface QuotePill {
  label: string;
  /** The app's pill palette — gray | amber | green | red. Never blue. */
  tone: "gray" | "amber" | "green" | "red";
}

export function pillOf(e: Estimate, bucket: QuoteBucket): QuotePill {
  if (bucket === "won") return { label: "Won", tone: "green" };
  if (bucket === "lost") return { label: "Lost", tone: "red" };
  if (bucket === "draft") return { label: "Draft", tone: "gray" };
  // Sent — the customer asking for changes is the fact worth a different word.
  return e.changeRequestedAt
    ? { label: "Changes asked", tone: "amber" }
    : { label: "Sent", tone: "amber" };
}

export interface LedgerRow {
  id: string;
  bucket: QuoteBucket;
  pill: QuotePill;
  customer: string;
  title: string;
  totalDollars: number;
  /** "today" / "3d" — the store's day-age, in the ledger's mono register. */
  ageLabel: string;
}

/** Archived paper is off the ledger by default — same rule as every other list. */
const shows = (e: Estimate): boolean => !e.archived && !e.trash;

export function ledgerRows(
  estimates: readonly Estimate[],
  leads: readonly Lead[],
  filter: QuoteFilter,
  query: string,
): LedgerRow[] {
  const q = query.trim().toLowerCase();
  const nameOf = (leadId: string) => leads.find((l) => l.id === leadId)?.name ?? "—";
  const rows: LedgerRow[] = [];
  for (const e of estimates) {
    if (!shows(e)) continue;
    const bucket = bucketOf(e);
    if (!bucket) continue;
    if (filter !== "all" && bucket !== filter) continue;
    const customer = nameOf(e.leadId);
    if (q && !`${customer} ${e.title}`.toLowerCase().includes(q)) continue;
    rows.push({
      id: e.id,
      bucket,
      pill: pillOf(e, bucket),
      customer,
      title: e.title,
      totalDollars: estTotal(e),
      ageLabel: e.age === 0 ? "today" : `${e.age}d`,
    });
  }
  // Newest paper first — the ledger reads backwards through the book.
  return rows.sort((a, b) => ageOf(a) - ageOf(b));
}

const ageOf = (r: LedgerRow): number => (r.ageLabel === "today" ? 0 : parseInt(r.ageLabel, 10));

export interface LedgerCounts {
  all: number;
  draft: number;
  sent: number;
  won: number;
  lost: number;
  /** Sum of SENT paper, in dollars — the money sitting on customers' phones. */
  outTheDoorDollars: number;
}

export function ledgerCounts(estimates: readonly Estimate[]): LedgerCounts {
  const c: LedgerCounts = { all: 0, draft: 0, sent: 0, won: 0, lost: 0, outTheDoorDollars: 0 };
  for (const e of estimates) {
    if (!shows(e)) continue;
    const bucket = bucketOf(e);
    if (!bucket) continue;
    c.all += 1;
    c[bucket] += 1;
    if (bucket === "sent") c.outTheDoorDollars += estTotal(e);
  }
  return c;
}
