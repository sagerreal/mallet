/**
 * features/pipeline/working.ts
 * Pure derivations for the board's first two columns. WORKING ITSELF = intake
 * the AI has in hand. GETTING THE NUMBER = the three routes a deal takes to a
 * price: a visit came back with scope notes (office owes the quote), a
 * walkthrough is on the books, or paper is being built in the shop — including
 * quotes a tech drafts standing on site, which land here the moment they exist.
 * A lead lives in exactly one column; columns move when reality moves.
 */

import { todayISO } from "@/lib/clock";
import { isCooling, traceOf } from "./pipeline-lanes";
import type { Estimate, Lead } from "@/lib/store/types";

export interface IntakeRow {
  lead: Lead;
  /** Past the healthy age for its stage — needs a word from the owner. */
  stalled: boolean;
  /** ≤4-word mono stamp: the freshest true thing. */
  stamp: string;
}

export interface GettingRow {
  lead: Lead;
  est: Estimate | null;
  kind: "scoped" | "visit" | "shop";
  stamp: string;
  /** Small verb label rendered after the stamp ("quote it ›", "finish ›"). */
  verb: string | null;
}

function weekdayOf(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
}

const alive = (l: Lead) =>
  !l.archived && !l.book && (l.stage === "New customer" || l.stage === "Contacted");

const scopedVisit = (l: Lead) => (l.evisits ?? []).find((v) => v.scopeNotes);
const pendingVisit = (l: Lead) =>
  (l.evisits ?? []).find((v) => v.status === "scheduled" && !v.scopeNotes && v.date);

/** Pre-quote intake — no visit route, no paper: the AI is nurturing them. */
/**
 * How one untouched lead READS as a card — the stamp, and whether it has gone quiet.
 *
 * Separate from the question of which leads belong in the column, because those two answers now
 * come from different places: membership is decided in SQL (leadViewCondition "intake") so the
 * column can describe the whole book, while the card's wording stays here where the rest of the
 * board's language lives.
 */
export function intakeRowOf(lead: Lead): IntakeRow {
  const stalled = isCooling(lead);
  const trace = traceOf(lead);
  const stamp = stalled
    ? `Quiet ${lead.age} days`
    : trace
      ? `Front Desk · ${trace.when}`
      : lead.age === 0
        ? "today"
        : `${lead.age}d`;
  return { lead, stalled, stamp };
}

/** Stalled first, then oldest — the order the column is worked in. */
export const byStalledThenAge = (a: IntakeRow, b: IntakeRow): number =>
  Number(b.stalled) - Number(a.stalled) || b.lead.age - a.lead.age;

/**
 * Untouched leads out of an in-memory collection.
 *
 * Kept for callers that hold the whole book already. The Pipeline board does NOT use this: its
 * membership test has to run against every customer, not the page the browser happens to hold,
 * and `hasPaper` here can only see the estimates that were loaded — so a lead whose quote fell
 * outside that window would be shown as untouched.
 */
export function deriveIntake(leads: Lead[], estimates: Estimate[]): IntakeRow[] {
  const hasPaper = (id: string) =>
    estimates.some((e) => e.leadId === id && !e.archived && !e.trash);

  return leads
    .filter((l) => alive(l) && !hasPaper(l.id) && !scopedVisit(l) && !pendingVisit(l))
    .map(intakeRowOf)
    .sort(byStalledThenAge);
}

/** Deals with an active route to a price — scoped / walkthrough booked / in the shop. */
export function deriveGetting(leads: Lead[], estimates: Estimate[]): GettingRow[] {
  const rows: GettingRow[] = [];

  // Paper being built (drafts) — includes quotes a tech starts on site.
  for (const est of estimates) {
    if (est.status !== "draft" || est.archived || est.trash) continue;
    const lead = leads.find((l) => l.id === est.leadId && !l.archived);
    if (!lead) continue;
    rows.push({ lead, est, kind: "shop", stamp: "in the shop", verb: "finish ›" });
  }

  const hasPaper = (id: string) =>
    estimates.some((e) => e.leadId === id && !e.archived && !e.trash);

  for (const lead of leads) {
    if (!alive(lead) || hasPaper(lead.id)) continue;
    const today = todayISO();
    const scoped = scopedVisit(lead);
    if (scoped) {
      rows.push({
        lead,
        est: null,
        kind: "scoped",
        stamp: scoped.date === today ? "scoped today" : "scoped",
        verb: "quote it ›",
      });
      continue;
    }
    const pending = pendingVisit(lead);
    if (pending?.date) {
      rows.push({
        lead,
        est: null,
        kind: "visit",
        stamp:
          pending.date === today ? "visit today" : `walkthrough ${weekdayOf(pending.date)}`,
        verb: null,
      });
    }
  }

  const rank = { scoped: 0, shop: 1, visit: 2 } as const;
  return rows.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
