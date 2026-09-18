// The deterministic post-call price audit — the third and final layer of the "never generate a
// price" guarantee (the prompt only holds sanctioned numbers; tool results carry the only spoken
// price text; this catches anything the model still invented). PURE: given the assistant-spoken
// lines and the set of owner-sanctioned dollar amounts (serviceFee + every flat-lane price), it
// returns the raw spoken tokens that were NOT sanctioned. A non-empty result is a violation and
// the recorder files a review task.
//
// The token regex mirrors prompt.ts's PRICE_TOKEN_RE (same "$"-amount grammar) but this module is
// deliberately self-contained/pure — no import coupling to the prompt builder, so the audit can be
// reasoned about and tested in complete isolation.

// A dollar-amount token: "$" + optional whitespace + digits, with optional thousands-commas and an
// optional decimal part (e.g. "$89", "$ 300", "$1,250.00"). Global so we extract every hit per line.
const PRICE_TOKEN_RE = /\$\s*\d[\d,]*(?:\.\d+)?/g;

// Normalize a spoken token OR an allowed dollar value to a canonical numeric key so formatting
// never causes a false flag: "$1,250.00", "$1250", and the number 1250 all collapse to "1250".
// Cents are preserved (89.50 ≠ 89) but a trailing ".00"/".0" and thousands-commas are dropped so
// an integer-dollar allowed value matches an integer-dollar spoken token regardless of formatting.
const normalizeAmount = (raw: string): string => {
  const digits = raw.replace(/[$,\s]/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return digits;
  // String(value) already normalizes formatting: 89 → "89", 89.50 → "89.5", so an integer-dollar
  // allowed value matches an integer-dollar spoken token no matter how it was written.
  return String(value);
};

/**
 * Extract every dollar figure from an owner-authored price string (e.g. a service ballpark).
 * "$150–$300" → [150, 300], "around $200" → [200], "" / no match → [].
 * Reuses PRICE_TOKEN_RE + normalizeAmount so extracted numbers match auditPrices' allowed-set keys.
 *
 * @param text an owner-authored price string (e.g. a service ballpark field).
 * @returns numeric dollar amounts extracted from the text, empty array when none found.
 */
export const extractDollarFigures = (text: string): number[] => {
  const matches = text.match(PRICE_TOKEN_RE);
  if (!matches) return [];
  return matches
    .map((token) => Number(normalizeAmount(token)))
    .filter((n) => Number.isFinite(n));
};

/**
 * Return every assistant-spoken dollar token that is NOT in the allowed set.
 *
 * @param assistantLines the assistant-role transcript lines (already filtered to the AI's turns).
 * @param allowedDollars the sanctioned amounts in DOLLARS (serviceFee + flat-lane service prices).
 * @returns the raw, original-formatting tokens that were not allowed, de-duplicated, first-seen order.
 */
export const auditPrices = (
  assistantLines: readonly string[],
  allowedDollars: readonly number[],
): string[] => {
  const allowed = new Set(allowedDollars.map((d) => normalizeAmount(String(d))));
  const flagged: string[] = [];
  const seen = new Set<string>();

  for (const line of assistantLines) {
    const matches = line.match(PRICE_TOKEN_RE);
    if (!matches) continue;
    for (const token of matches) {
      if (allowed.has(normalizeAmount(token))) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      flagged.push(token);
    }
  }

  return flagged;
};
