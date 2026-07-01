// lib/format.ts — the ONLY place money/dates become strings (money is integer cents everywhere).
export const formatMoney = (cents: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export const formatDate = (iso: string | null): string =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso)) : "—";

export const formatDateTime = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "—";
