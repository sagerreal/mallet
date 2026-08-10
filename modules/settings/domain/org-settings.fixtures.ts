import { asOrgId, type OrgId } from "@mallet/shared/types";
import type { OrgSettingsProps, BookingCfg } from "./org-settings";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");

const DEFAULT_BOOKING: BookingCfg = {
  services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
  notServices: "septic",
  serviceFee: 89,
  feeCredited: true,
};

/**
 * Valid OrgSettingsProps for domain tests. Brand fields default to null except
 * brandName which defaults to "My Business". Override any field via the `o` arg.
 */
export const baseSettingsProps = (o: Partial<OrgSettingsProps> = {}): OrgSettingsProps => ({
  orgId: ORG,
  trade: "plumbing",
  markupBps: 3500,
  taxBps: 0,
  visitScopeMinutes: 30,
  visitRepairMinutes: 90,
  visitInstallMinutes: 240,
  timesheetClock: true,
  techSeesPrice: true,
  techTexts: true,
  frontDesk: true,
  scopeOn: false,
  autoRemind: true,
  measurementEstimating: false,
  hoursWdOpen: 8,
  hoursWdClose: 17,
  hoursMonOpen: 8,
  hoursMonClose: 17,
  hoursTueOpen: 8,
  hoursTueClose: 17,
  hoursWedOpen: 8,
  hoursWedClose: 17,
  hoursThuOpen: 8,
  hoursThuClose: 17,
  hoursFriOpen: 8,
  hoursFriClose: 17,
  hoursSatOpen: 0,
  hoursSatClose: 0,
  hoursSunOpen: 0,
  hoursSunClose: 0,
  timezone: "America/Los_Angeles",
  areaCities: "Pleasanton",
  areaRadiusMi: 25,
  serviceOriginAddress: null,
  originLat: null,
  originLng: null,
  booking: DEFAULT_BOOKING,
  brandName: "My Business",
  brandTagline: null,
  brandSite: null,
  brandColor: null,
  brandLogoUrl: null,
  brandInitials: null,
  bizAddress: null,
  bizPhone: null,
  bizEmail: null,
  licenseNumber: null,
  stripeConnectedAccountId: null,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  stripeDetailsSubmitted: false,
  stripeOnboardedAt: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...o,
});
