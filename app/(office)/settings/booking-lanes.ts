// The three ways the front desk can handle a service. These are not a presentation detail — each
// one is a different thing the CALLER hears, decided by book-visit-speak.ts:
//
//   repair   → "The visit is $95, credited toward the repair if you go ahead."   (service call fee)
//   flat     → "Drain cleaning is $149 flat."                                    (the price you set)
//   estimate → "You're booked Thursday at 8am for a free estimate visit."        (no price at all)
//
// This used to be presented as two buttons — "Book it" and "Quote first" — with the third lane
// implied by whether a price field happened to be filled in. That made "service call" a thing you
// got by NOT doing something, so the list could not be read by type and the $95 never appeared
// anywhere near the service it applied to. Three lanes, three buttons, each stating its own
// consequence.

import type { BookingService } from "@/lib/store/slices/settings-slice";
import type { ServiceLane } from "@mallet/settings";

export const LANE_OPTIONS: ReadonlyArray<{ value: ServiceLane; label: string }> = [
  { value: "repair", label: "Service call" },
  { value: "flat", label: "Flat price" },
  { value: "estimate", label: "Free estimate" },
];

// Lanes that book a real job now. Emergency words only make sense here — an estimate visit is
// never the answer to a burst pipe.
export const isBookableLane = (lane: ServiceLane): boolean => lane !== "estimate";

// A flat lane with no price falls back to speaking the SERVICE FEE (book-visit-speak.ts), which is
// a different number than the owner meant to charge. Invalid, and the editor says so rather than
// letting it save quietly.
export const flatPriceMissing = (lane: ServiceLane, price: string): boolean =>
  lane === "flat" && !(Number(price) > 0);

// The collapsed-row chip. Says the TYPE, and for a flat service the actual price — so the list can
// be scanned without opening anything.
export function laneChipLabel(service: BookingService): string {
  if (service.lane === "estimate") return "Free estimate";
  if (service.lane === "flat") {
    return (service.price ?? 0) > 0 ? `$${service.price} flat` : "Price not set";
  }
  return "Service call";
}

// What the CALLER will hear. This is the information the two-button version had nowhere to put,
// and the reason the $95 felt like it came out of nowhere.
export function laneConsequence(lane: ServiceLane, price: string, serviceFee: number): string {
  if (lane === "estimate") return "Free 1–2 hour visit. The caller hears no price.";
  if (lane === "flat") {
    return Number(price) > 0
      ? `The caller hears “$${Number(price)} flat” and books at that price.`
      : "Enter the price the caller will be quoted.";
  }
  return `The tech prices it on site. The caller hears the $${serviceFee} service call fee.`;
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
