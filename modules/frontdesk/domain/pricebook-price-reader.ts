import type { BookingService } from "@mallet/settings";

/**
 * Port: current pricebook unit prices, in DOLLARS, keyed by pricebook service id.
 * The Front Desk playbook links a booking service to a pricebook entry
 * (pricebookServiceId) instead of carrying its own copy of the number — this is
 * how the linked price is read at answer time, so a pricebook change reaches the
 * phone immediately with no second source of truth.
 */
export interface PricebookPriceReader {
  unitPricesByIds(ids: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

/**
 * Overlays linked pricebook prices onto the playbook's services: a service with a
 * pricebookServiceId gets that entry's CURRENT price as its effective `price`;
 * unlinked services keep their own stored number (legacy behavior). A dangling
 * link (entry archived/deleted) falls back to the stored price if one exists —
 * never a silent zero on a live phone call.
 *
 * Both prompt building AND price-audit sanctioning must run on the RESOLVED list,
 * so linked prices are speakable and a legitimately-quoted linked price is never
 * flagged as unapproved.
 */
export async function resolveBookingPrices(
  services: readonly BookingService[],
  reader: PricebookPriceReader | undefined,
): Promise<readonly BookingService[]> {
  if (!reader) return services;
  const ids = services.map((s) => s.pricebookServiceId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return services;
  const prices = await reader.unitPricesByIds(ids);
  return services.map((s) => {
    if (!s.pricebookServiceId) return s;
    const linked = prices.get(s.pricebookServiceId);
    return linked != null ? { ...s, price: linked } : s;
  });
}
