// lib/format.ts — the ONLY place money/dates become strings (money is integer cents everywhere).

/**
 * Short relative timestamp used in conversation lists and message threads.
 * Accepts an ISO string or a Date.
 *   • Same day  → "9:04am"
 *   • This week → "Tue 2:10pm"
 *   • Older     → "Jul 7"
 */
export function shortWhen(isoOrDate: string | Date): string {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      .toLowerCase();
  }
  if (diffDays < 7) {
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    const time = d
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      .toLowerCase();
    return `${day} ${time}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/**
 * How long ago something happened, for a list column.
 *   • today / future (clock skew) → "Today"
 *   • 1 day                       → "Yesterday"
 *   • 2–6 days                    → "3d ago"
 *   • 7–29 days                   → "2w ago"
 *   • older                       → "Jun 17" ("Aug 3, 2024" across a year boundary)
 * An absent or unparseable stamp renders as an em dash — never "Invalid Date" or "NaNd ago".
 */
export function agoShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";

  const now = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;

  const sameYear = then.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(then);
}

export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const formatDate = (iso: string | null): string =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";

/**
 * A date on a DOCUMENT — "Aug 5, 2026". Carries the year, which `formatDate` deliberately does not.
 *
 * `formatDate` ("Aug 5") is for surfaces the reader is standing in: a list, a thread, a payment row
 * inside a bill they just opened. A document is different — an invoice gets filed, attached to a
 * claim, and read in March by someone who was not there. "Invoiced Aug 5" on a two-year-old bill is
 * ambiguous in a way that costs the shop the argument, so the invoice date, the service date and
 * the signed-on date all state the year.
 *
 * Null/absent renders as an em dash, same convention as the formatters above; callers that must
 * omit a missing date entirely check for it BEFORE calling (a document never prints a label with
 * no value).
 */
export const formatDocDate = (iso: string | null | undefined): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso))
    : "—";

export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "—";

// Prototype-sample money is plain DOLLARS (not cents) — fmt$ is its one formatter.
// Locale pinned to en-US: an undefined locale renders differently per machine and
// risks SSR hydration mismatches.
// The sign belongs to the amount, ahead of the currency: "$-41" reads as a price of minus-41,
// and next to a "+" prefix on screen it printed "+$-41".
export const fmt$ = (dollars: number): string => {
  const whole = Math.round(dollars);
  return whole < 0
    ? "-$" + Math.abs(whole).toLocaleString("en-US")
    : "$" + whole.toLocaleString("en-US");
};

// Cent-precise dollars formatter for money that can be sub-dollar (e.g. pricebook
// MATERIALS — a wax ring or fastener costs cents, so rounding to whole dollars would
// show "$0" and under-count a parts-cost rollup). Same en-US pinning as fmt$.
export const fmt$2 = (dollars: number): string =>
  dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });

// A RATE, which is whatever precision it actually has: cents when it has cents, whole dollars
// when it does not. "$123 / each" and "$2.25 / sq ft" in the same list, both true.
//
// fmt$ was the right formatter while a service meant "$2,400 water heater install". It is the
// wrong one the moment a shop prices per square foot: a painter's whole book lives between $0.16
// and $3.30 a unit, so fmt$ showed exterior power washing — $0.16/sq ft, a real rate on a real
// job — as "$0", and 2-coat walls at $2.25 as "$2". Neither is a rounding nicety; both are the
// wrong number on the screen the shop quotes from. fmt$2 everywhere would fix that and put ".00"
// on every flat-rate line to do it, so this splits the difference at the only place it matters.
export const fmt$rate = (dollars: number): string =>
  Number.isInteger(dollars) ? fmt$(dollars) : fmt$2(dollars);

// US phone pretty-printer for display surfaces: E.164 (or any 10/11-digit US
// string) → "(925) 555-0100". Anything unrecognizable passes through untouched —
// display must never eat a number it can't parse.
export const fmtPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
};
