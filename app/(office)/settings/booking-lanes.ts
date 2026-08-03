// TWO ways the front desk can handle a service — the same two the job record has since the
// flat-rate/estimate rework. Each is a different thing the CALLER hears (book-visit-speak.ts):
//
//   flat               → "Drain cleaning is $149 flat."                             (price known)
//   estimate + fee     → "The visit is $95, credited toward the work if you go ahead." (priced on site)
//   estimate, no fee   → "You're booked Thursday at 8am for a free estimate visit."  (quote after)
//
// The old third lane — "repair", the service call — was an estimate booking with the visit fee
// attached; that is a per-service flag now, not a type. One vocabulary from the phone to the
// schedule board: a caller books either a price or a look.

import type { BookingService } from "@/lib/store/slices/settings-slice";
import type { ServiceLane } from "@mallet/settings";

export const LANE_OPTIONS: ReadonlyArray<{ value: ServiceLane; label: string }> = [
  { value: "flat", label: "Flat price" },
  { value: "estimate", label: "Estimate" },
];

// Emergency words belong on services a tech goes out to FIX — flat work and fee visits. A free
// quote-first estimate is never the answer to a burst pipe.
export const emergencyWordsApply = (svc: Pick<BookingService, "lane" | "feeApplies">): boolean =>
  svc.lane === "flat" || svc.feeApplies === true;

// A flat lane with no price falls back to speaking the SERVICE FEE (book-visit-speak.ts), which is
// a different number than the owner meant to charge. Invalid, and the editor says so rather than
// letting it save quietly.
export const flatPriceMissing = (lane: ServiceLane, price: string): boolean =>
  lane === "flat" && !(Number(price) > 0);

// The collapsed-row chip. Says the TYPE, and for a flat service the actual price — so the list can
// be scanned without opening anything.
export function laneChipLabel(service: BookingService): string {
  if (service.lane === "flat") {
    return (service.price ?? 0) > 0 ? `$${service.price} flat` : "Price not set";
  }
  return service.feeApplies ? "Estimate · fee" : "Estimate · free";
}

// What the CALLER will hear. This is the information the two-button version had nowhere to put,
// and the reason the $95 felt like it came out of nowhere.
export function laneConsequence(
  lane: ServiceLane,
  price: string,
  serviceFee: number,
  feeApplies?: boolean,
): string {
  if (lane === "flat") {
    return Number(price) > 0
      ? `The caller hears “$${Number(price)} flat” and books at that price.`
      : "Enter the price the caller will be quoted.";
  }
  return feeApplies
    ? `The tech prices it on site. The caller hears the $${serviceFee} visit fee, credited toward the work.`
    : "Free visit — the office quotes after. The caller hears no price.";
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
