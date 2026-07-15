// Pure helpers for the Booking tab's BINARY service model. The OWNER thinks in two routes —
// "Book it" (a regular job: schedule a visit) vs "Quote first" (an estimate job) — with PRICE as
// an optional attribute of a bookable job. STORAGE keeps the original three lanes untouched
// (repair/estimate/flat drive the AI prompt + job kind); this module is the two-way mapping.
//
//   Book it   + no price  → lane "repair"   (tech prices on site)
//   Book it   + price set → lane "flat"     (booked at the set price)
//   Quote first           → lane "estimate" (estimate visit, then you quote; optional ballpark)

import type { BookingService } from "@/lib/store/slices/settings-slice";

export type BookingRoute = "book" | "quote";

export function routeOf(lane: BookingService["lane"]): BookingRoute {
  return lane === "estimate" ? "quote" : "book";
}

// The stored lane for a route + price pair. `price` is the raw input string ("" = unset).
export function laneFor(route: BookingRoute, price: string): BookingService["lane"] {
  if (route === "quote") return "estimate";
  const n = Number(price);
  return price.trim() !== "" && Number.isFinite(n) && n > 0 ? "flat" : "repair";
}

// ---- Ballpark: structured low/high ↔ the stored display string ("$150–$300") ------------

export interface BallparkRange {
  low: string; // raw input strings so the fields can be cleared while editing
  high: string;
}

// Extract up to two dollar figures from a stored ballpark string. "$150–$300" → {150, 300};
// "around $200" → {200, ""}; anything without a number → both empty.
export function parseBallpark(value: string): BallparkRange {
  const nums = value.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const clean = (s: string | undefined): string => (s ? s.replace(/,/g, "") : "");
  return { low: clean(nums[0]), high: clean(nums[1]) };
}

// Format low/high back to the stored string. Both → "$150–$300"; low only → "$150"; none → "".
export function formatBallpark(r: BallparkRange): string {
  const low = r.low.trim();
  const high = r.high.trim();
  if (low && high) return `$${low}–$${high}`;
  if (low) return `$${low}`;
  if (high) return `$${high}`;
  return "";
}
