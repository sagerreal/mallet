// lib/format.ts — the ONLY place money/dates become strings (money is integer cents everywhere).
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
