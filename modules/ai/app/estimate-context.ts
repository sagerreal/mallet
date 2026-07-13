import type { CatalogServiceContext } from "./draft-estimate";

// ---------------------------------------------------------------------------
// Estimate-draft context — the org-specific knowledge both drafters consume.
// ---------------------------------------------------------------------------
// Pure module: types, prompt-block builders, the won-quote lexical matcher and
// the stages payload. Everything here is unit-testable with plain fixtures;
// the DB-touching composition lives in ../infra/estimate-context.ts.
//
// Deliberate exclusions (Owen's call): NO markup and NO cost basis in any
// prompt — price context is the customer-facing pricebook + labor rates only.
// ---------------------------------------------------------------------------

export interface LaborRateContext {
  readonly label: string;
  readonly rateCentsPerHour: number; // per hour when kind='hourly', flat charge otherwise
  readonly kind: "hourly" | "flat_fee";
}

export interface JobInfoMessage {
  readonly direction: "inbound" | "outbound";
  readonly body: string;
}

export interface JobInfoContext {
  readonly lead: {
    readonly name: string;
    readonly source: string | null;
    readonly notes: string | null;
    readonly address: string | null;
  } | null;
  readonly messages: readonly JobInfoMessage[];
  readonly visitNotes: readonly string[];
}

export interface WonQuoteExemplar {
  readonly num: string;
  readonly title: string | null;
  readonly lines: readonly { description: string; quantity: number; rateCents: number }[];
  readonly totalCents: number;
}

/** One confirmed shop rule that matched this job (quoting_rules, L2 memory). */
export interface ShopRuleContext {
  readonly rule: string;
  readonly timesConfirmed: number;
}

export interface EstimateContext {
  readonly catalog: readonly CatalogServiceContext[];
  readonly laborRates: readonly LaborRateContext[];
  readonly jobInfo: JobInfoContext | null;
  readonly wonQuotes: readonly WonQuoteExemplar[];
  readonly rules: readonly ShopRuleContext[];
}

export const EMPTY_ESTIMATE_CONTEXT: EstimateContext = {
  catalog: [],
  laborRates: [],
  jobInfo: null,
  wonQuotes: [],
  rules: [],
};

/**
 * The real-artifact counts each draft response carries so the composer's run
 * reveal renders true numbers ("3 notes · 2 texts", "41 services · 2 labor
 * rates", "compared against Q-1037, Q-1052"). jobInfo is null when the draft
 * ran without a lead.
 */
export interface DraftStages {
  readonly jobInfo: { notes: number; texts: number; visitNotes: number } | null;
  readonly pricebook: { services: number; laborRates: number };
  readonly rules: { count: number };
  readonly wonQuotes: { count: number; nums: string[] };
}

export const stagesFor = (ctx: EstimateContext): DraftStages => ({
  jobInfo: ctx.jobInfo
    ? {
        notes: ctx.jobInfo.lead?.notes?.trim() ? 1 : 0,
        texts: ctx.jobInfo.messages.length,
        visitNotes: ctx.jobInfo.visitNotes.length,
      }
    : null,
  pricebook: { services: ctx.catalog.length, laborRates: ctx.laborRates.length },
  rules: { count: ctx.rules.length },
  wonQuotes: { count: ctx.wonQuotes.length, nums: ctx.wonQuotes.map((q) => q.num) },
});

// ---- truncation -------------------------------------------------------------

// Server-side caps: each free-text artifact is clipped, and whole blocks carry
// their own budgets, so a pathological lead history can never blow the prompt.
const CLIP_TEXT = 500;
export const JOB_INFO_BLOCK_MAX = 4_000;
export const WON_QUOTES_BLOCK_MAX = 1_500;

export const clip = (s: string, max = CLIP_TEXT): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

const capBlock = (lines: readonly string[], max: number): string => {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > max) break;
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
};

// ---- prompt blocks ----------------------------------------------------------

/** "## This shop's pricebook" — name [category]: $price (labor hours when known). */
export const buildPricebookBlock = (catalog: readonly CatalogServiceContext[]): string => {
  if (catalog.length === 0) return "";
  const rows = catalog.map((s) => {
    const price = (s.unitPriceCents / 100).toFixed(2);
    const cat = s.category ? ` [${s.category}]` : "";
    const hours = s.laborHours != null ? ` — ${s.laborHours}h labor` : "";
    return `- ${s.name}${cat}: $${price}${hours}`;
  });
  return [
    "## This shop's pricebook",
    "Prefer these exact prices for any line that matches a catalog service below (match by",
    'description/intent, not exact wording). For any line that is NOT in the catalog, prefix its',
    'description with "Off-book: " so the office knows to double-check that price, and price it',
    "from typical trade pricing.",
    ...rows,
  ].join("\n");
};

/** "## This shop's labor rates" — for labor lines not covered by a catalog match. */
export const buildLaborRatesBlock = (rates: readonly LaborRateContext[]): string => {
  if (rates.length === 0) return "";
  const rows = rates.map((r) => {
    const amount = (r.rateCentsPerHour / 100).toFixed(2);
    return r.kind === "hourly" ? `- ${r.label}: $${amount}/hour` : `- ${r.label}: $${amount} flat`;
  });
  return [
    "## This shop's labor rates",
    "Use these for labor lines that are not covered by a pricebook match.",
    ...rows,
  ].join("\n");
};

/** "## The job" — what we already know from the lead: notes, texts, visit findings. */
export const buildJobInfoBlock = (jobInfo: JobInfoContext | null): string => {
  if (!jobInfo) return "";
  const lines: string[] = [];
  if (jobInfo.lead) {
    const l = jobInfo.lead;
    lines.push(`Customer: ${clip(l.name, 120)}${l.source ? ` (came in via ${clip(l.source, 60)})` : ""}`);
    if (l.address?.trim()) lines.push(`Service address: ${clip(l.address, 200)}`);
    if (l.notes?.trim()) lines.push(`Office notes: ${clip(l.notes)}`);
  }
  if (jobInfo.messages.length > 0) {
    lines.push("Recent texts (oldest first):");
    for (const m of jobInfo.messages) {
      lines.push(`  ${m.direction === "inbound" ? "Customer" : "Us"}: ${clip(m.body)}`);
    }
  }
  if (jobInfo.visitNotes.length > 0) {
    lines.push("Field notes from visits:");
    for (const n of jobInfo.visitNotes) lines.push(`  - ${clip(n)}`);
  }
  if (lines.length === 0) return "";
  return capBlock(
    [
      "## The job — what we already know",
      "Use this context to scope the estimate correctly. The office's typed request below is",
      "authoritative when they conflict.",
      ...lines,
    ],
    JOB_INFO_BLOCK_MAX,
  );
};

/** Prompt cap — matches the repo's findMatching default; sliced again here defensively. */
export const RULES_BLOCK_MAX_RULES = 20;

/**
 * "## This shop's rules" — the confirmed conditionals the shop has taught the
 * estimator (quoting_rules). The caller supplies them matched to THIS job and
 * ordered by times_confirmed desc (most-corroborated first).
 */
export const buildRulesBlock = (rules: readonly ShopRuleContext[]): string => {
  if (rules.length === 0) return "";
  const rows = rules.slice(0, RULES_BLOCK_MAX_RULES).map((r) => `- ${clip(r.rule, 320)}`);
  return [
    "## This shop's rules",
    "The shop has confirmed these corrections/conventions — follow them when they apply to this job.",
    ...rows,
  ].join("\n");
};

/** "## Quotes this shop sent and WON" — episodic exemplars, capped. */
export const buildWonQuotesBlock = (wonQuotes: readonly WonQuoteExemplar[]): string => {
  if (wonQuotes.length === 0) return "";
  const lines: string[] = [];
  for (const q of wonQuotes) {
    lines.push(`${q.num}${q.title ? ` — ${clip(q.title, 100)}` : ""} (total $${(q.totalCents / 100).toFixed(2)}):`);
    for (const l of q.lines) {
      lines.push(`  - ${clip(l.description, 160)} ×${l.quantity} @ $${(l.rateCents / 100).toFixed(2)}`);
    }
  }
  return capBlock(
    [
      "## Quotes this shop sent and WON (price like these)",
      "These are real quotes this shop sent for similar work and the customer accepted.",
      ...lines,
    ],
    WON_QUOTES_BLOCK_MAX,
  );
};

/**
 * All context blocks, joined — appended to either drafter's base prompt.
 * Empty sections vanish entirely (no headers over nothing).
 */
export const buildContextBlocks = (ctx: EstimateContext): string =>
  [
    buildJobInfoBlock(ctx.jobInfo),
    buildPricebookBlock(ctx.catalog),
    buildLaborRatesBlock(ctx.laborRates),
    buildRulesBlock(ctx.rules),
    buildWonQuotesBlock(ctx.wonQuotes),
  ]
    .filter((b) => b !== "")
    .join("\n\n");

// ---- won-quote lexical matcher ----------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at",
  "new", "old", "replace", "repair", "fix", "install", "job", "quote",
]);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

/**
 * Rank candidate won quotes by lexical overlap with the job description
 * (any-word match on title + line descriptions). Ties keep input order, so
 * pass candidates newest-first for recency preference. Zero-overlap quotes
 * never match — better no exemplar than a misleading one.
 */
export const matchWonQuotes = (
  description: string,
  candidates: readonly WonQuoteExemplar[],
  limit = 3,
): WonQuoteExemplar[] => {
  const queryTokens = new Set(tokens(description));
  if (queryTokens.size === 0) return [];
  const scored = candidates.map((q, i) => {
    const hay = new Set(tokens(`${q.title ?? ""} ${q.lines.map((l) => l.description).join(" ")}`));
    let score = 0;
    for (const t of queryTokens) if (hay.has(t)) score += 1;
    return { q, score, i };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.q);
};
