/**
 * features/pipeline/pipeline-lanes.ts
 * The three-question board model. The owner doesn't run a sales funnel; he asks
 * three things each morning — what's the AI working, who's sitting on a quote,
 * and who needs a word only I can give. Lanes are DERIVED from real store state
 * (stage, age vs. norm, quotes, scoped visits), never groomed by hand, so the
 * board is fully useful if he never touches it.
 */

import type { Lead, Estimate } from "@/lib/store/types";
import { stageNorm } from "./pipeline-constants";
import { leadVal, isScopedNeedsQuote } from "./pipeline-utils";

export const LANES = ["Working", "Waiting", "Needs you"] as const;
export type Lane = (typeof LANES)[number];

export const LANE_LABEL: Record<Lane, string> = {
  Working: "Working itself",
  Waiting: "Waiting on them",
  "Needs you": "Needs you",
};

/** A lead is stalled once it sits past the healthy age for its stage. */
export function isCooling(lead: Lead): boolean {
  return lead.age > stageNorm(lead.stage);
}

/** Which of the three questions this lead answers today. */
export function laneOf(lead: Lead, estimates: Estimate[]): Lane {
  // Scoped on site but never quoted — the office owes them a quote. Always yours.
  if (isScopedNeedsQuote(lead, estimates)) return "Needs you";

  const cooling = isCooling(lead);
  if (lead.stage === "Quote Sent") {
    // A quote is out: fresh → their move; gone quiet past norm → your nudge.
    return cooling ? "Needs you" : "Waiting";
  }
  // New / Contacted: the Front Desk is nurturing it unless it has stalled.
  return cooling ? "Needs you" : "Working";
}

/** A real, non-draft quote exists for this lead — the only case a $ shows on the face. */
export function hasQuote(lead: Lead, estimates: Estimate[]): boolean {
  return estimates.some((e) => e.leadId === lead.id && e.status !== "draft");
}

/** Forward money at risk: the sum of quotes out and awaiting a decision. */
export function moneyInPlay(leads: Lead[], estimates: Estimate[]): number {
  return leads
    .filter((l) => !l.book && !l.archived && l.stage === "Quote Sent")
    .reduce((s, l) => s + leadVal(l, estimates), 0);
}

/** This lead was worked by the Front Desk on the overnight shift. */
export function isOvernight(lead: Lead): boolean {
  return (lead.acts ?? []).some((a) => a.overnight);
}

// ---- card street label ------------------------------------------------------

/** "1420 Vineyard Ave, Pleasanton" → "Vineyard Ave" — the enriched anchor, no city, no number. */
export function streetOf(address?: string): string {
  if (!address) return "";
  const firstPart = address.split(",")[0]?.trim() ?? "";
  return firstPart.replace(/^\d+\s+/, "");
}

// ---- the live line (one dynamic element per card) ---------------------------

export interface TraceLine {
  when: string;
  text: string;
}

const FIRST = (name: string) => name.split(" ")[0] ?? name;

/**
 * The completed-work trace for a card the AI touched: the freshest overnight/AI
 * act, in the owner's words, with its timestamp. Returns null when there's
 * nothing specific to say (silence is legible — we never manufacture a status).
 */
export function traceOf(lead: Lead): TraceLine | null {
  const acts = lead.acts ?? [];
  // Prefer the freshest overnight act — that's the "while you slept" story.
  const overnight = [...acts].reverse().find((a) => a.overnight);
  const act = overnight ?? null;
  if (!act) return null;

  if (act.type === "call") {
    return { when: act.when, text: `Front Desk caught ${FIRST(lead.name)} — took the details` };
  }
  if (act.type === "ai") {
    // e.g. "Maria opened quote Q-1043 — second look this week." → keep it tight.
    return { when: act.when, text: act.t ?? "worked by the Front Desk" };
  }
  if (act.type === "text" && act.from === "them") {
    return { when: act.when, text: `${FIRST(lead.name)} replied — “${act.t ?? ""}”` };
  }
  if (act.type === "text") {
    return { when: act.when, text: "Front Desk texted a booking link" };
  }
  return { when: act.when, text: act.t ?? "worked by the Front Desk" };
}

// ---- the drafted next move (Needs-you lane) ---------------------------------

const JOB_SHORT = (job: string) => job.replace(/\s*[—-].*$/, "").toLowerCase().trim();

/** A ready-to-send nudge for a lead that's gone quiet — the exact words, drafted for you. */
export function draftNudge(lead: Lead): string {
  const first = FIRST(lead.name);
  const job = JOB_SHORT(lead.job || "the job");
  if (lead.stage === "Quote Sent") {
    return `Hi ${first}, still want us to handle the ${job}? Happy to hold a spot this week.`;
  }
  return `Hi ${first} — following up on the ${job}. Want to get you on the schedule?`;
}

// ---- the board verdict (one forward money-in-motion line) -------------------

export interface Verdict {
  needsYou: number;
  inPlay: number;
  quotesOut: number;
  openedOvernight: number;
  bookedOvernight: string[];
  caughtOvernight: string[];
}

/** First names joined for prose: ["A"]→"A", ["A","B"]→"A and B", more→"A, B and C". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The single forward-looking read for the top of the board. */
export function deriveVerdict(leads: Lead[], estimates: Estimate[]): Verdict {
  const board = leads.filter(
    (l) => !l.book && !l.archived && l.stage !== "Lost" && l.stage !== "Won"
  );
  return {
    needsYou: board.filter((l) => laneOf(l, estimates) === "Needs you").length,
    inPlay: moneyInPlay(leads, estimates),
    quotesOut: board.filter((l) => l.stage === "Quote Sent").length,
    openedOvernight: leads.filter((l) =>
      (l.acts ?? []).some((a) => a.overnight && a.type === "ai")
    ).length,
    bookedOvernight: leads
      .filter((l) => l.book && (l.acts ?? []).some((a) => a.overnight))
      .map((l) => FIRST(l.name)),
    caughtOvernight: board
      .filter(
        (l) =>
          l.stage === "New customer" &&
          (l.acts ?? []).some((a) => a.overnight && a.type === "call")
      )
      .map((l) => FIRST(l.name)),
  };
}
