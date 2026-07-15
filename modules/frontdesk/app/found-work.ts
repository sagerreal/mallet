// Conservative, trade-agnostic signals that a booked job may turn up MORE work than the caller
// described (so the office can budget time). Matching is case-insensitive, whole-ish words.
export const FOUND_WORK_KEYWORDS = [
  "old",
  "aging",
  "rust",
  "rusty",
  "corro",
  "leak",
  "leaking",
  "damage",
  "damaged",
  "crack",
  "cracked",
  "mold",
  "rot",
  "rotten",
  "original",
  "years old",
] as const;

// Prefix used when the caller's note trips a found-work keyword — visible in the office/job view.
const FOUND_WORK_PREFIX = "[likely found-work] ";

// True when the caller's scope note trips a found-work keyword (case-insensitive, whole-ish words).
// Pure — no I/O.
export function scopeSuggestsFoundWork(scope: string): boolean {
  if (!scope) return false;
  const lower = scope.toLowerCase();
  return FOUND_WORK_KEYWORDS.some((kw) => lower.includes(kw));
}

// The scope note to persist: the trimmed answer, prefixed with a functional marker when it looks
// like found-work so the office sees the flag on the job. Empty/whitespace → null.
// Pure — no I/O. Cap defensively is unnecessary (Job.create caps at 4000 chars).
export function decorateScope(scopeSignal: string | null | undefined): string | null {
  if (scopeSignal == null) return null;
  const trimmed = scopeSignal.trim();
  if (!trimmed) return null;
  return scopeSuggestsFoundWork(trimmed) ? `${FOUND_WORK_PREFIX}${trimmed}` : trimmed;
}
