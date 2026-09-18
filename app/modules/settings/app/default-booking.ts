import type { BookingCfg } from "../domain/org-settings";

/**
 * First-run booking config for a brand-new org: NO services.
 *
 * This used to return nine hard-coded residential plumbing services with invented flat prices —
 * "Drain cleaning $99", "Sewer camera inspection $285" — to every org regardless of trade. Its own
 * comment admitted the provenance: "Ported verbatim from the prototype's SEED_BOOKING so a fresh
 * workspace opens with a usable booking playbook rather than an empty screen."
 *
 * Two things were wrong with that, and the second is the serious one:
 *
 *  1. A roofing shop's front desk offered water heater repair.
 *  2. Those prices were OURS, not the shop's. Had the front desk been switched on, it would have
 *     quoted $99 drain cleaning to a real caller on the shop's behalf. The trade playbooks
 *     (app/(office)/settings/trade-playbooks.ts) have always refused to seed a price for exactly
 *     this reason — "prices are the owner's, never ours" — and this file contradicted that rule
 *     for every org in the product.
 *
 * Services now come from the shop's OWN trade, applied at signup from its trade playbook, which
 * carries trigger phrases and lanes but no dollar amounts. A trade with no playbook, and "Other",
 * get nothing at all.
 *
 * Empty is also the safe default rather than merely the honest one: frontDeskReadiness requires at
 * least one bookable service, so an org that never picks a trade keeps its front desk switched off
 * instead of answering with a service list it cannot honour.
 *
 * The non-service fields stay. A service-call fee and whether it is credited are shop POLICY
 * rather than trade content, and these are the conventional starting values — the owner sees them
 * on the Front Desk tab and can change them there.
 */
export const defaultBooking = (): BookingCfg => ({
  services: [],
  notServices: "",
  serviceFee: 89,
  feeCredited: true,
});
