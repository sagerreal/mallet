/**
 * features/counter/matcher.ts
 * The typing state: three letters of a name → the person, their live situation,
 * and verbs ranked by what that situation calls for. Pure functions over the
 * snapshot — every keystroke filters local data, nothing rounds a trip.
 * Situations reuse the OK-queue derivation so the bar and Home can never
 * disagree about why someone needs you.
 */

import { deriveOkQueue, firstName, type OkItem } from "@/features/home/derive";
import { isScopedNeedsQuote } from "@/features/pipeline/pipeline-utils";
import { estTotal, invDue } from "@/lib/estimates";
import type { Lead } from "@/lib/store/types";
import { buildEstimateRun } from "./estimate-run";
import type { PersonRow, Snap, Suggestion, Verb } from "./types";

const MAX_ROWS = 4;

/** Leads whose name has a word starting with the query (min 2 chars). */
export function findLeads(query: string, leads: Lead[]): Lead[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return leads.filter(
    (l) => !l.archived && l.name.toLowerCase().split(" ").some((w) => w.startsWith(q))
  );
}

/** The OK-queue item for one lead (uncapped: queue derived for that lead alone). */
export function okItemFor(lead: Lead, snap: Snap): OkItem | null {
  const items = deriveOkQueue([lead], snap.estimates, snap.invoices, []);
  return items[0] ?? null;
}

function verbsFor(lead: Lead, item: OkItem | null, snap: Snap): Verb[] {
  const first = firstName(lead.name).toLowerCase();
  const call: Verb = { label: "call", input: `call ${first}` };
  const open: Verb = { label: "open", input: `open ${first}` };

  if (item?.kind === "reply") return [{ label: "reply", input: `reply ${first}` }, call, open];
  if (item?.kind === "quote-viewed") return [{ label: "nudge", input: `nudge ${first}` }, call, open];
  if (item?.kind === "invoice-overdue") return [{ label: "remind", input: `remind ${first}` }, call, open];
  if (item?.kind === "new-lead") return [{ label: "text", input: `text ${first}` }, call, open];
  if (isScopedNeedsQuote(lead, snap.estimates, snap.jobs)) {
    return [{ label: "quote", input: `quote ${first}` }, open, call];
  }
  return [open, call];
}

function situationFor(lead: Lead, item: OkItem | null, snap: Snap): string {
  if (item) {
    if (item.kind === "quote-viewed" && item.estimate) {
      return `read the $${Math.round(estTotal(item.estimate)).toLocaleString("en-US")} quote, quiet ${item.estimate.age}d`;
    }
    return item.situation;
  }
  const est = snap.estimates.find(
    (e) => e.leadId === lead.id && e.status === "sent" && !e.archived && !e.trash
  );
  if (est) return `$${Math.round(estTotal(est)).toLocaleString("en-US")} quote out, ${est.age}d`;
  const inv = snap.invoices.find(
    (i) => i.leadId === lead.id && !i.archived && (i.status === "sent" || i.status === "partial") && invDue(i) > 0
  );
  if (inv) return `owes $${Math.round(invDue(inv)).toLocaleString("en-US")} · ${inv.num}`;
  if (isScopedNeedsQuote(lead, snap.estimates, snap.jobs)) return "scoped on site — owe them a quote";
  if (lead.stage === "Won") return `won — ${lead.last.toLowerCase()}`;
  if (lead.stage === "Lost") return `lost${lead.lossReason ? ` — ${lead.lossReason.toLowerCase()}` : ""}`;
  return lead.job || lead.last;
}

/** One lead as a bar row: live situation + verbs ranked by it. */
export function personRow(lead: Lead, snap: Snap): PersonRow {
  const item = okItemFor(lead, snap);
  return {
    lead,
    situation: situationFor(lead, item, snap),
    verbs: verbsFor(lead, item, snap),
  };
}

/** Rows for the typing state, most-at-stake first. */
export function matchRows(query: string, snap: Snap): PersonRow[] {
  return findLeads(query, snap.leads)
    .map((lead) => {
      const item = okItemFor(lead, snap);
      return {
        lead,
        situation: situationFor(lead, item, snap),
        verbs: verbsFor(lead, item, snap),
        _value: item?.value ?? 0,
        _live: item ? 1 : 0,
      };
    })
    .sort((a, b) => b._live - a._live || b._value - a._value)
    .slice(0, MAX_ROWS)
    .map(({ lead, situation, verbs }) => ({ lead, situation, verbs }));
}

// ---- the focused empty state: suggestions with live stakes ------------------------

/** Sum of money answerable right now (quotes out + invoice balances due). */
export function reachableMoney(snap: Snap): number {
  // SERVER truth when the surface fetched it — the store sums below see one page.
  if (snap.serverMoney) return snap.serverMoney.quotesOutDollars + snap.serverMoney.owedDollars;
  const quotes = snap.estimates
    .filter((e) => !e.archived && !e.trash && e.status === "sent")
    .reduce((s, e) => s + estTotal(e), 0);
  const owed = snap.invoices
    .filter((i) => !i.archived && (i.status === "sent" || i.status === "partial"))
    .reduce((s, i) => s + invDue(i), 0);
  return quotes + owed;
}

/**
 * Four verbs the shop needs TODAY, each naming a live record — the empty state
 * is the to-do list, never a blank face. A verb with zero stake doesn't appear.
 */
export function deriveSuggestions(snap: Snap): Suggestion[] {
  const out: Suggestion[] = [];
  const money = reachableMoney(snap);

  // Estimating is the trade's core chore: a sweep's worth of unquoted work leads
  // the list; a single unfinished draft gets its own verb instead.
  const estPlan = buildEstimateRun(snap);
  if (estPlan.items.length >= 2) {
    const lead = estPlan.items[0]?.lead;
    out.push({
      label: "go quote what's scoped",
      stake: `${estPlan.items.length} waiting on a number${lead ? ` — ${firstName(lead.name)}'s first` : ""}`,
      input: "go quote what's scoped",
    });
  } else {
    const draft = snap.estimates.find((e) => e.status === "draft" && !e.archived && !e.trash);
    const draftLead = draft ? snap.leads.find((l) => l.id === draft.leadId && !l.archived) : null;
    if (draft && draftLead) {
      out.push({
        label: `quote ${firstName(draftLead.name)} the ${draft.title.toLowerCase()}`,
        input: `quote ${firstName(draftLead.name).toLowerCase()}`,
      });
    }
  }

  if (money > 0) {
    out.push({
      label: "what money can I go get today?",
      stake: `$${Math.round(money).toLocaleString("en-US")} out`,
      input: "what money can I go get today?",
    });
    out.push({ label: "go get the money", input: "go get the money" });
  }

  // A brand-new untouched lead — get them booked.
  const fresh = snap.leads.find(
    (l) =>
      !l.archived &&
      l.stage === "New customer" &&
      !l.book &&
      !l.unread &&
      !(l.acts ?? []).some((a) => a.from === "us" || a.from === "auto")
  );
  if (fresh) {
    out.push({
      label: `book ${firstName(fresh.name)} this week`,
      stake: fresh.job ? fresh.job.toLowerCase() : undefined,
      input: `book ${firstName(fresh.name).toLowerCase()} this week`,
    });
  }

  return out.slice(0, 4);
}
