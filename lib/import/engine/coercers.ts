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

  /**
   * Calendar date → "YYYY-MM-DD". No timezone is applied: a date in a spreadsheet is a calendar
   * day, and converting it through a zone is how a job lands on the wrong one.
   *
   * Ambiguous slash dates are read as MONTH FIRST (US), matching the beachhead market. That is a
   * genuine guess — 03/04 is March 4 here and April 3 in most of the world — so it is stated in
   * the mapping preview rather than applied silently. ISO input is never ambiguous and wins.
   */
  date: (raw) => {
    const value = raw.trim();

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (iso) return isoOrBad(Number(iso[1]), Number(iso[2]), Number(iso[3]), value);

    const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
    if (slash) {
      const year = Number(slash[3]);
      // A 2-digit year is this century: a shop's job sheet is not from 1926.
      return isoOrBad(year < 100 ? 2000 + year : year, Number(slash[1]), Number(slash[2]), value);
    }

    return bad(`Couldn't read date "${raw}"`);
  },

  /** Clock time → "HH:MM", 24-hour. Accepts "14:30", "2:30 PM", "2pm". */
  time: (raw) => {
    const value = raw.trim().toLowerCase();
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value);
    if (!match) return bad(`Couldn't read time "${raw}"`);

    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3];

    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return bad(`Couldn't read time "${raw}"`);

    return ok(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  },
};

/**
 * Build "YYYY-MM-DD", rejecting a date that does not exist. Round-tripping through UTC catches
 * 31 February, which a bare range check would wave through.
 */
function isoOrBad(year: number, month: number, day: number, raw: string): CoerceResult {
  if (month < 1 || month > 12 || day < 1 || day > 31) return bad(`Couldn't read date "${raw}"`);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return bad(`Couldn't read date "${raw}"`);
  }
  return ok(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}
