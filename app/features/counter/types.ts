/**
 * features/counter/types.ts
 * The Counter's shared shapes. All user input is routed through the LLM agent
 * (v1.ai.run / v1.ai.resume); artifacts are what the panel renders. Gates carry
 * the exact outbound words — the only thing in the whole surface that ever waits
 * on the owner.
 */

import type { Lead, Estimate, Invoice, Job, Tech, EstimateLine } from "@/lib/store/types";
import type { OkItem } from "@/features/home/derive";

/** Read-only view of the store the pure layers work from. */
export interface Snap {
  leads: Lead[];
  estimates: Estimate[];
  invoices: Invoice[];
  jobs: Job[];
  techs: Tech[];
  brandName: string;
  /**
   * SERVER-computed truth, when the composing surface fetched it. The store
   * collections above are one hydrator page each — any figure the agent SPEAKS
   * must come from these, never from summing the page.
   */
  serverMoney?: { quotesOutDollars: number; owedDollars: number };
  /** Server-ranked OK-queue items (uncapped) — replaces the store-join derivation. */
  okItems?: import("@/features/home/derive").OkItem[];
  /** Server-selected "waiting on a number" customers (the quoting view). */
  quotingLeads?: Lead[];
}

// ---- opening records ---------------------------------------------------------

export type OpenRef =
  | { type: "lead" | "thread"; id: string; label: string }
  | { type: "est" | "invoice"; id: string; label: string }
  | { type: "page"; path: string; label: string };

// ---- the gate (approval-before-consequence) -----------------------------------

/** How a gated send commits: through the OK-queue primitive, by flipping a
 *  draft quote to sent, or as a plain owner-voiced text. */
export type Gate =
  | { kind: "ok-item"; item: OkItem; text: string }
  | { kind: "quote-send"; estId: string; leadId: string; leadFirst: string; text: string }
  | { kind: "plain-text"; leadId: string; leadFirst: string; text: string };

export interface SentMark {
  when: string;
  undo: () => void;
  expiresAt: number;
}

// ---- artifacts -----------------------------------------------------------------

export interface AnswerRow {
  fig?: string;
  text: string;
  open?: OpenRef;
}

export interface RunStep {
  key: string;
  /** Money mode: the OK-queue item the send commits through. */
  item?: OkItem;
  /** Estimates mode: what Send-all does — flip this draft to sent + text the link. */
  estSend?: { estId: string; leadId: string; leadFirst: string; smsText: string };
  title: string;
  /** The evidence line — where the price/words came from. */
  sub: string;
  /** The exact outbound text (shown by "look at each"). */
  draft: string;
  /** Dollar figure for the row, when the step carries one. */
  fig?: string;
  open?: OpenRef;
}

export interface RunAside {
  leadId: string;
  reason: string;
  open: OpenRef;
  /** A next move the aside can fire directly ("book a visit ›"). */
  verb?: { label: string; input: string };
}

/** One pending tool-use action from the agent, awaiting human approval. */
export interface AiPendingItem {
  toolUseId: string;
  tool: string;
  argsJson: string;
  summary: string;
}

export type Artifact =
  | {
      kind: "quote";
      estId: string;
      num: string;
      leadName: string;
      title: string;
      lines: EstimateLine[];
      total: number;
      /** True when an existing draft was picked up instead of starting another. */
      picked: boolean;
      /** Verbatim evidence line ("pulled from his texts: …"), or null. */
      sourced: string | null;
      gate: Gate;
      sent?: SentMark;
    }
  | {
      kind: "answer";
      head: string | null;
      rows: AnswerRow[];
      verb: { label: string; input: string } | null;
    }
  | {
      kind: "run";
      mode: "money" | "estimates";
      headline: string;
      steps: RunStep[];
      asides: RunAside[];
      totalChased: number;
      sent?: SentMark;
    }
  | { kind: "gate-only"; situation: string | null; gate: Gate; sent?: SentMark }
  | { kind: "confirm"; lines: string[]; open?: OpenRef; gate?: Gate; sent?: SentMark }
  | {
      kind: "choices";
      prompt: string;
      options: { label: string; hint: string; input: string }[];
    }
  | { kind: "miss"; text: string; suggestions: Suggestion[] }
  /** A plain text result from the LLM agent (completed status). */
  | { kind: "ai-result"; text: string }
  /** Agent is proposing writes — carries the pending actions + transcript for resume. */
  | { kind: "ai-approval"; pending: AiPendingItem[]; transcript: string; assistantText: string }
  /** A transient placeholder shown while the LLM mutation is in flight. */
  | { kind: "ai-thinking" };

export interface Entry {
  id: number;
  request: string;
  artifact: Artifact;
}

// ---- matcher rows + suggestions ---------------------------------------------------

export interface Verb {
  label: string;
  input: string;
}

export interface PersonRow {
  lead: Lead;
  situation: string;
  /** First verb is the Tab default. */
  verbs: Verb[];
}

export interface Suggestion {
  label: string;
  stake?: string;
  input: string;
}
