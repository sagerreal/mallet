/**
 * features/counter/estimate-run.ts
 * "go quote what's scoped" — the estimating twin of the money run. Pure planner:
 * sweeps every lead that's owed a quote and prices with an honest evidence
 * gradient — the shop's own won quotes first ("same job as Q-1037"), labor-math
 * where there's no history, and a set-aside where nothing's been seen (never a
 * fake number for an unseen slab leak). A scheduled walkthrough holds its lead
 * out of the run — on camera, with the reason. Drafts commit in the executor;
 * the ONE gate is the outbound texts.
 */

import { firstName } from "@/features/home/derive";
import { estTotal } from "@/lib/estimates";
import type { Estimate, EstimateLine, Lead } from "@/lib/store/types";
import type { RunAside, Snap } from "./types";

/** One planned draft: lines + the evidence line that justifies the price. */
export interface EstPlanItem {
  lead: Lead;
  title: string;
  lines: EstimateLine[];
  /** Where the number came from — cited, never asserted. */
  evidence: string;
  /** Reuse this existing draft instead of creating a second one. */
  pickupEstId: string | null;
}

export interface EstRunPlan {
  items: EstPlanItem[];
  asides: RunAside[];
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Keywords that mean "you can't price this from the office". */
const NEEDS_EYES = /slab leak|leak somewhere|water damage|sewer back|unknown|mystery|not sure/i;

/** Small-repair bank for jobs with no history match (labor-math, said plainly). */
const SMALL_REPAIRS: { match: RegExp; title: string; line: EstimateLine }[] = [
  {
    match: /hose bib|spigot|outdoor faucet/i,
    title: "Hose bib replacement",
    line: { d: "Hose bib replacement — supply & install", q: 1, r: 285 },
  },
  {
    match: /faucet/i,
    title: "Faucet replacement",
    line: { d: "Faucet replacement — supply & install", q: 1, r: 340 },
  },
  {
    match: /garbage disposal|disposal/i,
    title: "Garbage disposal replacement",
    line: { d: "Garbage disposal — supplied & installed", q: 1, r: 420 },
  },
];

/** Job-word themes for matching a lead to the shop's own past quotes. */
const THEMES: { key: string; match: RegExp }[] = [
  { key: "repipe", match: /repipe/i },
  { key: "water heater", match: /water heater|tankless/i },
  { key: "toilet", match: /toilet/i },
  { key: "drain", match: /drain|clog|backed up/i },
];

/** The shop's best precedent for a theme — won beats sent, newest first. */
function historyMatch(theme: string, estimates: Estimate[]): Estimate | null {
  const usable = estimates.filter(
    (e) =>
      !e.archived &&
      !e.trash &&
      (e.status === "accepted" || e.status === "sent") &&
      (e.title.toLowerCase().includes(theme) ||
        e.lines.some((l) => l.d.toLowerCase().includes(theme)))
  );
  usable.sort((a, b) => {
    if (a.status !== b.status) return a.status === "accepted" ? -1 : 1;
    return a.age - b.age;
  });
  return usable[0] ?? null;
}

/** A lead the run may quote: active, pre-quote stage, no live estimate out. */
function quotable(lead: Lead, estimates: Estimate[]): boolean {
  if (lead.archived || lead.book) return false;
  if (lead.stage !== "New customer" && lead.stage !== "Contacted") return false;
  return !estimates.some(
    (e) => e.leadId === lead.id && !e.archived && !e.trash && e.status !== "draft"
  );
}

function scopedNotes(lead: Lead): string | null {
  const done = (lead.evisits ?? []).find((v) => v.scopeNotes);
  return done?.scopeNotes ?? null;
}

function pendingVisit(lead: Lead): boolean {
  return (lead.evisits ?? []).some((v) => v.status === "scheduled" && !v.scopeNotes);
}

/** Price one lead, or null when there's nothing honest to price from. */
function priceLead(lead: Lead, snap: Snap): Omit<EstPlanItem, "lead" | "pickupEstId"> | null {
  const notes = scopedNotes(lead);
  const theme = THEMES.find((t) => t.match.test(lead.job))?.key ?? null;

  // History first — the shop's own numbers are the best estimator there is.
  if (theme) {
    const precedent = historyMatch(theme, snap.estimates);
    if (precedent) {
      const from = notes
        ? `priced from Mike's scope notes + your last ${theme} (${precedent.num}${
            precedent.status === "accepted" ? `, won at ${fmt(estTotal(precedent))}` : ""
          })`
        : `same job as ${precedent.num}${
            precedent.status === "accepted" ? ` — won at ${fmt(estTotal(precedent))}` : ""
          }, lines from your history`;
      return {
        title: precedent.title,
        lines: precedent.lines.map((l) => ({ ...l })),
        evidence: from,
      };
    }
  }

  // No history — a small-repair rate, stated as labor math.
  const small = SMALL_REPAIRS.find((s) => s.match.test(lead.job));
  if (small) {
    return {
      title: small.title,
      lines: [{ ...small.line }],
      evidence: "no history for this one — priced at 1.5h standard labor + parts",
    };
  }

  return null;
}

export function buildEstimateRun(snap: Snap): EstRunPlan {
  const items: EstPlanItem[] = [];
  const asides: RunAside[] = [];

  for (const lead of snap.leads) {
    if (!quotable(lead, snap.estimates)) continue;
    const first = firstName(lead.name);

    // An unfinished draft is the first thing to pick back up.
    const draft = snap.estimates.find(
      (e) => e.leadId === lead.id && e.status === "draft" && !e.archived && !e.trash
    );
    if (draft) {
      items.push({
        lead,
        title: draft.title,
        lines: draft.lines,
        evidence: `picked up your draft ${draft.num} — it was sitting unfinished`,
        pickupEstId: draft.id,
      });
      continue;
    }

    // A walkthrough already on the books — hold, with the reason on camera.
    if (pendingVisit(lead) && !scopedNotes(lead)) {
      asides.push({
        leadId: lead.id,
        reason: `${lead.name} — walkthrough's already on the books; pricing after it happens`,
        open: { type: "lead", id: lead.id, label: "open them" },
      });
      continue;
    }

    // Never invent a number for a job nobody's seen.
    if (NEEDS_EYES.test(lead.job) && !scopedNotes(lead)) {
      asides.push({
        leadId: lead.id,
        reason: `${lead.name} — ${lead.job.toLowerCase()}: not pricing what nobody's seen`,
        open: { type: "lead", id: lead.id, label: "open them" },
        verb: { label: `book ${first} ›`, input: `book ${first.toLowerCase()} this week` },
      });
      continue;
    }

    const priced = priceLead(lead, snap);
    if (priced) {
      items.push({ lead, pickupEstId: null, ...priced });
    } else if (lead.job) {
      // Quotable but unpriceable — same honest exit as the unseen job.
      asides.push({
        leadId: lead.id,
        reason: `${lead.name} — ${lead.job.toLowerCase()}: nothing in your history to price it from`,
        open: { type: "lead", id: lead.id, label: "open them" },
        verb: { label: `book ${first} ›`, input: `book ${first.toLowerCase()} this week` },
      });
    }
  }

  // Scoped-and-noted work leads the receipt; everything else follows by value.
  items.sort((a, b) => {
    const an = scopedNotes(a.lead) ? 1 : 0;
    const bn = scopedNotes(b.lead) ? 1 : 0;
    if (an !== bn) return bn - an;
    const sum = (ls: EstimateLine[]) => ls.reduce((s, l) => s + l.q * l.r, 0);
    return sum(b.lines) - sum(a.lines);
  });

  return { items, asides };
}
