import type { QuoteTier } from "./estimate";

// ---------------------------------------------------------------------------
// Edit-delta differ — what did the office change about the AI's draft?
// ---------------------------------------------------------------------------
// Pure and deterministic (NO LLM): the send path diffs the ai_draft snapshot
// against the lines actually sent. Material deltas become PROPOSED
// quoting_rules — never confirmed, never from a single event (the repo's
// review queue hides edit-delta proposals until ≥2 independent recurrences).
// Equivalence between observations = same jobTag + same rulePrefix (kind +
// direction), so a recurring correction bumps one proposal instead of
// stacking duplicates.
// ---------------------------------------------------------------------------

/** One line of the AI's original draft (persisted as estimates.ai_draft). */
export interface AiDraftLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly tier?: QuoteTier | null;
}

/** The full snapshot: the AI's lines + when it drafted them. */
export interface AiDraftSnapshot {
  readonly lines: readonly AiDraftLine[];
  readonly at: string; // ISO timestamp
}

/** A sent estimate's line, as the differ sees it. */
export interface SentLineView {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly isOptional: boolean;
  readonly tier: QuoteTier | null;
}

export type EditDeltaKind = "price" | "quantity" | "added" | "removed";

export interface EditDelta {
  readonly kind: EditDeltaKind;
  readonly direction: "up" | "down" | null;
  /** Keyword scope for the proposal — also half of the equivalence key. */
  readonly jobTag: string;
  /** Stable sentence prefix — the other half of the equivalence key. */
  readonly rulePrefix: string;
  /** The full proposed rule sentence (≤300 chars by construction). */
  readonly rule: string;
}

/** A change is material when it moves more than 10% off the AI's figure. */
export const MATERIAL_CHANGE_RATIO = 0.1;
/** Hard cap per send — one pathological edit session never floods the queue. */
export const MAX_DELTAS_PER_SEND = 10;

const JOB_TAG_MAX = 100;
const DESC_MAX = 80;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at",
]);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

const normalize = (s: string): string => tokens(s).join(" ");

/** The keyword tag an observation is scoped by — also what service names normalize through. */
export const jobTagFor = (description: string): string => normalize(description).slice(0, JOB_TAG_MAX).trim();

/**
 * Token-SET overlap (Jaccard) between two tags/descriptions, 0..1. Order and
 * duplicates don't matter — "labor water heater swap" and "water heater swap
 * labor charge" overlap 4/5 = 0.8. The miner uses this for recurrence
 * equivalence: real AI redrafts phrase the same line differently per estimate.
 */
export const tagTokenOverlap = (a: string, b: string): number => {
  const aTokens = new Set(tokens(a));
  const bTokens = new Set(tokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let shared = 0;
  for (const t of bTokens) if (aTokens.has(t)) shared += 1;
  return shared / (aTokens.size + bTokens.size - shared);
};

const clipDesc = (s: string): string => (s.length <= DESC_MAX ? s : `${s.slice(0, DESC_MAX - 1)}…`);

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const materiallyDifferent = (aiValue: number, sentValue: number): boolean => {
  if (aiValue === 0) return sentValue !== 0;
  return Math.abs(sentValue - aiValue) / aiValue > MATERIAL_CHANGE_RATIO;
};

interface Pair {
  readonly ai: AiDraftLine;
  readonly sent: SentLineView;
}

/**
 * Should two fuzzy descriptions pair at all? One shared generic token ("water",
 * "labor") is NOT evidence the lines describe the same work — a false pair mints
 * a confidently wrong price/quantity rule where an honest Adds+Drops was true.
 * Bar: ≥2 shared tokens, OR exactly one shared token that makes up ≥50% of
 * BOTH descriptions' token sets (e.g. "Labor" ↔ "Labor charge").
 */
const meetsPairingBar = (shared: number, aiTokenCount: number, sentTokenCount: number): boolean =>
  shared >= 2 || (shared === 1 && aiTokenCount <= 2 && sentTokenCount <= 2);

/**
 * Greedy description matcher within one tier bucket: exact normalized-text
 * matches pair first, then best token-overlap pairs (descending score) among
 * pairs that clear meetsPairingBar. Unpaired lines fall through to
 * added/removed (the safe degradation).
 */
const pairLines = (
  aiLines: readonly AiDraftLine[],
  sentLines: readonly SentLineView[],
): { pairs: Pair[]; unpairedAi: AiDraftLine[]; unpairedSent: SentLineView[] } => {
  const aiLeft = [...aiLines];
  const sentLeft = [...sentLines];
  const pairs: Pair[] = [];

  // Pass 1: exact normalized equality.
  for (let i = aiLeft.length - 1; i >= 0; i -= 1) {
    const ai = aiLeft[i]!;
    const j = sentLeft.findIndex((s) => normalize(s.description) === normalize(ai.description));
    if (j !== -1) {
      pairs.push({ ai, sent: sentLeft[j]! });
      aiLeft.splice(i, 1);
      sentLeft.splice(j, 1);
    }
  }

  // Pass 2: best token overlap, greedy by score — only pairs clearing the bar.
  const scored: { score: number; ai: AiDraftLine; sent: SentLineView }[] = [];
  for (const ai of aiLeft) {
    const aiTokens = new Set(tokens(ai.description));
    for (const sent of sentLeft) {
      const sentTokens = new Set(tokens(sent.description));
      let score = 0;
      for (const t of sentTokens) if (aiTokens.has(t)) score += 1;
      if (meetsPairingBar(score, aiTokens.size, sentTokens.size)) scored.push({ score, ai, sent });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const usedAi = new Set<AiDraftLine>();
  const usedSent = new Set<SentLineView>();
  for (const { ai, sent } of scored) {
    if (usedAi.has(ai) || usedSent.has(sent)) continue;
    usedAi.add(ai);
    usedSent.add(sent);
    pairs.push({ ai, sent });
  }

  return {
    pairs,
    unpairedAi: aiLeft.filter((l) => !usedAi.has(l)),
    unpairedSent: sentLeft.filter((l) => !usedSent.has(l)),
  };
};

const priceDelta = (ai: AiDraftLine, sent: SentLineView): EditDelta => {
  const direction = sent.rateCents > ai.rateCents ? "up" : "down";
  const rulePrefix = `Price ${direction}:`;
  return {
    kind: "price",
    direction,
    jobTag: jobTagFor(ai.description),
    rulePrefix,
    rule: `${rulePrefix} "${clipDesc(ai.description)}" goes out around ${usd(sent.rateCents)}, not ${usd(ai.rateCents)}`,
  };
};

const quantityDelta = (ai: AiDraftLine, sent: SentLineView): EditDelta => {
  const direction = sent.quantity > ai.quantity ? "up" : "down";
  const rulePrefix = `Quantity ${direction}:`;
  return {
    kind: "quantity",
    direction,
    jobTag: jobTagFor(ai.description),
    rulePrefix,
    rule: `${rulePrefix} "${clipDesc(ai.description)}" usually takes ${sent.quantity}, not ${ai.quantity}`,
  };
};

const addedDelta = (sent: SentLineView): EditDelta => ({
  kind: "added",
  direction: null,
  jobTag: jobTagFor(sent.description),
  rulePrefix: "Adds:",
  rule: `Adds: jobs like this usually include "${clipDesc(sent.description)}" (${usd(sent.rateCents)})`,
});

const removedDelta = (ai: AiDraftLine): EditDelta => ({
  kind: "removed",
  direction: null,
  jobTag: jobTagFor(ai.description),
  rulePrefix: "Drops:",
  rule: `Drops: jobs like this usually don't need "${clipDesc(ai.description)}"`,
});

/**
 * Diff the AI's draft against what the office actually sent. Lines pair
 * within their tier (a GBB draft compares Good to Good, never Good to Best).
 * Material deltas only: >10% price/quantity moves, added non-optional lines,
 * removed lines. Capped at MAX_DELTAS_PER_SEND. Lines whose descriptions
 * carry no usable keywords produce no delta (nothing to scope a rule to).
 */
export const diffAiDraft = (
  aiLines: readonly AiDraftLine[],
  sentLines: readonly SentLineView[],
): EditDelta[] => {
  const tierKey = (t: QuoteTier | null | undefined): string => t ?? "";
  const buckets = new Set([...aiLines.map((l) => tierKey(l.tier)), ...sentLines.map((l) => tierKey(l.tier))]);

  const deltas: EditDelta[] = [];
  for (const bucket of buckets) {
    const { pairs, unpairedAi, unpairedSent } = pairLines(
      aiLines.filter((l) => tierKey(l.tier) === bucket),
      sentLines.filter((l) => tierKey(l.tier) === bucket),
    );
    for (const { ai, sent } of pairs) {
      if (materiallyDifferent(ai.rateCents, sent.rateCents)) deltas.push(priceDelta(ai, sent));
      if (materiallyDifferent(ai.quantity, sent.quantity)) deltas.push(quantityDelta(ai, sent));
    }
    for (const sent of unpairedSent) {
      if (!sent.isOptional) deltas.push(addedDelta(sent));
    }
    for (const ai of unpairedAi) deltas.push(removedDelta(ai));
  }

  return deltas.filter((d) => d.jobTag !== "").slice(0, MAX_DELTAS_PER_SEND);
};
