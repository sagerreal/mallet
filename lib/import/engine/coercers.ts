/**
 * The coercer registry: raw CSV cell → typed value, or a reason it couldn't be read.
 *
 * This is what makes the engine extend without engine changes. A new FIELD of an existing type is
 * a descriptor entry and nothing else. A genuinely new TYPE is one function added here, after
 * which every entity can use it.
 *
 * Coercers never throw and never look at other cells — they take one string and return a Result.
 * How a failure affects the ROW is the descriptor's business (`onInvalid`), not theirs.
 */

import { parseMoneyCents } from "../parse-money";
import type { CoercerId, ImportFieldSpec } from "./descriptor";

export type CoerceResult =
  | { readonly ok: true; readonly value: unknown }
  /** `reason` is quoted into the user-facing warning, so it names the actual problem. */
  | { readonly ok: false; readonly reason: string };

export type Coercer = (raw: string, spec: ImportFieldSpec) => CoerceResult;

const ok = (value: unknown): CoerceResult => ({ ok: true, value });
const bad = (reason: string): CoerceResult => ({ ok: false, reason });

/** Mirrors Phone.parse in shared/types/ids.ts: 10 US digits, or 11 with a leading 1. */
function phoneLooksValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Spellings that mean "yes" in a spreadsheet. Anything else is false rather than an error — a
 * blank or "no" in a taxable column is an ordinary answer, not a broken cell.
 */
const TRUTHY = new Set(["yes", "y", "true", "1", "taxable", "tax", "t"]);

export const COERCERS: Readonly<Record<CoercerId, Coercer>> = {
  /** Trim and clamp. Clamping happens in buildRows so every type gets it, not just text. */
  text: (raw) => ok(raw),

  phone: (raw) => (phoneLooksValid(raw) ? ok(raw) : bad(`Couldn't read phone "${raw}"`)),

  email: (raw) => (EMAIL_RE.test(raw) ? ok(raw) : bad(`Couldn't read email "${raw}"`)),

  /** Integer cents. Delegates to the existing parser — "$1,250.00" → 125000, negatives rejected. */
  money: (raw) => {
    const cents = parseMoneyCents(raw);
    return cents === null ? bad(`Couldn't read amount "${raw}"`) : ok(cents);
  },

  integer: (raw) => {
    const n = Number(raw.replace(/,/g, "").trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) return bad(`Couldn't read number "${raw}"`);
    return ok(n);
  },

  /** Never fails: an unrecognised value is simply not-true. */
  boolean: (raw) => ok(TRUTHY.has(raw.trim().toLowerCase())),

  enum: (raw, spec) => {
    const table = spec.enumValues ?? {};
    const hit = table[raw.trim().toLowerCase()];
    return hit === undefined ? bad(`Unrecognised value "${raw}"`) : ok(hit);
  },
};
