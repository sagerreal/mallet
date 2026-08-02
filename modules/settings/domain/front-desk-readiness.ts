import type { OrgSettingsProps } from "./org-settings";

/**
 * Whether the AI front desk is configured well enough to answer a customer.
 *
 * front_desk defaulted to true, so a brand-new shop was given a phone number pointed at an
 * assistant that knew nobody's hours, no service area and no bookable services. Answering in that
 * state is worse than not answering: it is the shop's number, and the caller is a real customer.
 */

export type FrontDeskGap = "hours" | "serviceArea" | "services";

export interface FrontDeskReadiness {
  readonly ready: boolean;
  readonly missing: readonly FrontDeskGap[];
}

/** One day counts as open when its close hour is after its open hour. */
function hasAnyOpenDay(p: OrgSettingsProps): boolean {
  const days: readonly (readonly [number, number])[] = [
    [p.hoursMonOpen, p.hoursMonClose],
    [p.hoursTueOpen, p.hoursTueClose],
    [p.hoursWedOpen, p.hoursWedClose],
    [p.hoursThuOpen, p.hoursThuClose],
    [p.hoursFriOpen, p.hoursFriClose],
    [p.hoursSatOpen, p.hoursSatClose],
    [p.hoursSunOpen, p.hoursSunClose],
  ];
  return days.some(([open, close]) => close > open);
}

export function frontDeskReadiness(p: OrgSettingsProps): FrontDeskReadiness {
  const missing: FrontDeskGap[] = [];

  if (!hasAnyOpenDay(p)) missing.push("hours");
  // Distance is measured from the origin address, so without one there is nothing to measure from
  // and every caller is either in range or out of it by accident.
  if ((p.serviceOriginAddress ?? "").trim().length === 0) missing.push("serviceArea");
  // An assistant that knows no services can book nothing.
  if (p.booking.services.length === 0) missing.push("services");

  return { ready: missing.length === 0, missing };
}
