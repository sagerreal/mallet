/**
 * features/pipeline/pipeline-lanes.ts
 * Per-CARD language for the board: is this lead cooling, what did the AI do to
 * it overnight, and the drafted nudge. Board MEMBERSHIP and the board-level
 * figures live in SQL (leadViewCondition / server counts) — the old whole-board
 * derivations that summed one browser page of the store are gone.
 */

import type { Lead } from "@/lib/store/types";
import { stageNorm } from "./pipeline-constants";

/** A lead is stalled once it sits past the healthy age for its stage. */
export function isCooling(lead: Lead): boolean {
  return lead.age > stageNorm(lead.stage);
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
