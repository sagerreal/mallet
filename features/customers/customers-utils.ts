/**
 * features/customers/customers-utils.ts
 * Pure filter + sort helpers for the Customers list.
 */

import type { Lead } from "@/lib/store/types";

// Whether the Customers (People) list should show the first-run empty state instead of the list
// chrome. True ONLY on a SUCCESSFUL, empty load: a still-loading list (isFetched === false) must
// not flash the empty screen, and a FAILED load (isError) must not be mistaken for "no customers"
// (that would wrongly tell a real shop to add their first one). `count` is the TOTAL leads (active
// + archived) — a shop with only archived customers is not first-run.
export interface FirstRunInput {
  readonly isFetched: boolean;
  readonly isError: boolean;
  readonly count: number;
}

export function shouldShowFirstRun({ isFetched, isError, count }: FirstRunInput): boolean {
  return isFetched && !isError && count === 0;
}

export function filterLeads(leads: Lead[], q: string, stage: string, source: string): Lead[] {
  const lq = q.toLowerCase();
  return leads.filter((l) => {
    if (l.archived) return false;
    if (
      lq &&
      !(l.name + " " + l.phone + " " + (l.job ?? "") + " " + (l.email ?? ""))
        .toLowerCase()
        .includes(lq)
    )
      return false;
    if (stage && l.stage !== stage) return false;
    if (source && l.source !== source) return false;
    return true;
  });
}

const STAGE_ORDER = ["New customer", "Contacted", "Quote Sent", "Won", "Lost"];

export function sortLeads(rows: Lead[], col: string | null, dir: number): Lead[] {
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    if (col === "name") return a.name.localeCompare(b.name) * dir;
    if (col === "age") return (a.age - b.age) * dir;
    if (col === "stage")
      return (STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)) * dir;
    return 0;
  });
}
