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
export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const formatDate = (iso: string | null): string =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";

export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "—";

// Prototype-sample money is plain DOLLARS (not cents) — fmt$ is its one formatter.
// Locale pinned to en-US: an undefined locale renders differently per machine and
// risks SSR hydration mismatches.
export const fmt$ = (dollars: number): string =>
  "$" + Math.round(dollars).toLocaleString("en-US");

// Cent-precise dollars formatter for money that can be sub-dollar (e.g. pricebook
// MATERIALS — a wax ring or fastener costs cents, so rounding to whole dollars would
// show "$0" and under-count a parts-cost rollup). Same en-US pinning as fmt$.
export const fmt$2 = (dollars: number): string =>
  dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });

// US phone pretty-printer for display surfaces: E.164 (or any 10/11-digit US
// string) → "(925) 555-0100". Anything unrecognizable passes through untouched —
// display must never eat a number it can't parse.
export const fmtPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
};
