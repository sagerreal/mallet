import { asOrgId } from "@mallet/shared/types";
import { orgSettings } from "@mallet/shared/db/schema";
import { OrgSettings, type BookingCfg } from "../domain/org-settings";

// The persistence row shape, inferred from the schema.
export type OrgSettingsRow = typeof orgSettings.$inferSelect;

/**
 * Reconstruct the OrgSettings aggregate from a DB row.
 * The booking column is jsonb — trusted (written only by this app) but corrupt data
 * throws rather than silently coercing, matching the companies pattern.
 *
 * @param row     - The org_settings DB row.
 * @param orgName - The org's display name from orgs.name (NOT stored in org_settings).
 *                  The repository joins orgs before calling this function so the real
 *                  name is always supplied; the brand aggregate never carries a placeholder.
 */
export const toOrgSettings = (row: OrgSettingsRow, orgName: string): OrgSettings => {
  const result = OrgSettings.create({
    orgId: asOrgId(row.orgId),
    trade: row.trade,
    markupBps: row.markupBps,
    taxBps: row.taxBps,
    visitScopeMinutes: row.visitScopeMinutes,
    visitRepairMinutes: row.visitRepairMinutes,
    visitInstallMinutes: row.visitInstallMinutes,
    timesheetClock: row.timesheetClock,
    techSeesPrice: row.techSeesPrice,
    techTexts: row.techTexts,
    frontDesk: row.frontDesk,
    scopeOn: row.scopeOn,
    autoRemind: row.autoRemind,
    measurementEstimating: row.measurementEstimating,
    hoursWdOpen: row.hoursWdOpen,
    hoursMonOpen: row.hoursMonOpen,
    hoursMonClose: row.hoursMonClose,
    hoursTueOpen: row.hoursTueOpen,
    hoursTueClose: row.hoursTueClose,
    hoursWedOpen: row.hoursWedOpen,
    hoursWedClose: row.hoursWedClose,
    hoursThuOpen: row.hoursThuOpen,
    hoursThuClose: row.hoursThuClose,
    hoursFriOpen: row.hoursFriOpen,
    hoursFriClose: row.hoursFriClose,
    hoursWdClose: row.hoursWdClose,
    hoursSatOpen: row.hoursSatOpen,
    hoursSatClose: row.hoursSatClose,
    hoursSunOpen: row.hoursSunOpen,
    hoursSunClose: row.hoursSunClose,
    timezone: row.timezone,
    areaCities: row.areaCities,
    areaRadiusMi: row.areaRadiusMi,
    // Service origin (front-desk vertical coverage) — all nullable in the DB.
    serviceOriginAddress: row.serviceOriginAddress ?? null,
    originLat: row.originLat ?? null,
    originLng: row.originLng ?? null,
    // Jsonb is typed as `unknown` by Drizzle — cast to BookingCfg. The DB enforces NOT NULL
    // and only this app writes the column, so a bad cast indicates programmer error or migration
    // skew: throw loudly so it surfaces immediately rather than propagating corrupted config.
    booking: row.booking as BookingCfg,
    // Brand identity: name comes from orgs.name (passed via orgName); the rest from the row.
    // Task 5 will replace the default with a real join. All optional cols may be null.
    brandName: orgName,
    brandTagline: row.brandTagline ?? null,
    brandSite: row.brandSite ?? null,
    brandColor: row.brandColor ?? null,
    brandLogoUrl: row.brandLogoUrl ?? null,
    brandInitials: row.brandInitials ?? null,
    // Business identity printed on customer documents. All nullable — an org that has never
    // filled them in reads back four nulls and every document omits the rows it has no value for.
    bizAddress: row.bizAddress ?? null,
    bizPhone: row.bizPhone ?? null,
    bizEmail: row.bizEmail ?? null,
    licenseNumber: row.licenseNumber ?? null,
    // Stripe Connect (Express) onboarding state (PR1).
    stripeConnectedAccountId: row.stripeConnectedAccountId ?? null,
    stripeChargesEnabled: row.stripeChargesEnabled,
    stripePayoutsEnabled: row.stripePayoutsEnabled,
    stripeDetailsSubmitted: row.stripeDetailsSubmitted,
    stripeOnboardedAt: row.stripeOnboardedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt org_settings ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
