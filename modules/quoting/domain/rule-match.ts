import type { QuotingRule } from "./quoting-rule";

// ---------------------------------------------------------------------------
// Pure keyword matcher: which confirmed rules apply to a job description?
// ---------------------------------------------------------------------------
// Mirrors the won-quote lexical matcher (modules/ai): lowercase tokens ≥3
// chars minus stop words, any-word overlap. No embeddings — a rule's scope
// (its service's name and/or its job tag) either shares a word with the job
// text or it doesn't. Unscoped rules (no service, no tag) are shop-wide and
// always apply.
// ---------------------------------------------------------------------------

/** A rule candidate with its service's display name resolved (null when unscoped). */
export interface RuleCandidate {
  readonly rule: QuotingRule;
  readonly serviceName: string | null;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "to", "of", "in", "on", "at",
  "new", "old", "replace", "repair", "fix", "install", "job", "quote",
]);

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

export const DEFAULT_RULE_MATCH_LIMIT = 20;

/**
 * Do two rule scopes cover the same ground? Used for contradiction detection
 * (a new rule that overlaps a confirmed one must go through review, and a
 * confirm supersedes what it overlaps). Deliberately SIMPLE: same service, or
 * any shared job-tag keyword. Two unscoped rules do NOT overlap — shop-wide
 * notes coexist.
 */
export const scopesOverlap = (
  a: { readonly serviceId: string | null; readonly jobTag: string | null },
  b: { readonly serviceId: string | null; readonly jobTag: string | null },
): boolean => {
  if (a.serviceId !== null && a.serviceId === b.serviceId) return true;
  if (a.jobTag && b.jobTag) {
    const bTokens = new Set(tokens(b.jobTag));
    return tokens(a.jobTag).some((t) => bTokens.has(t));
  }
  return false;
};

/**
 * The active confirmed rules that apply to `jobText`, ordered by
 * times_confirmed desc (most-corroborated knowledge first), capped at `limit`.
 * Ties keep input order. Candidates are assumed active+confirmed — the repo
 * filters status; this ranks scope relevance only.
 */
export const matchRules = (
  jobText: string,
  candidates: readonly RuleCandidate[],
  limit = DEFAULT_RULE_MATCH_LIMIT,
): RuleCandidate[] => {
  const queryTokens = new Set(tokens(jobText));
  const applies = (c: RuleCandidate): boolean => {
    const scope = `${c.serviceName ?? ""} ${c.rule.props.jobTag ?? ""}`.trim();
    if (scope === "") return true; // unscoped = shop-wide
    return tokens(scope).some((t) => queryTokens.has(t));
  };
  return candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => applies(c))
    .sort((a, b) => b.c.rule.props.timesConfirmed - a.c.rule.props.timesConfirmed || a.i - b.i)
    .slice(0, limit)
    .map(({ c }) => c);
};
