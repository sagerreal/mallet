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
    visitScopeMinutes: row.visitScopeMinutes,
    visitRepairMinutes: row.visitRepairMinutes,
    visitInstallMinutes: row.visitInstallMinutes,
    techSeesPrice: row.techSeesPrice,
    techTexts: row.techTexts,
    frontDesk: row.frontDesk,
    scopeOn: row.scopeOn,
    hoursWdOpen: row.hoursWdOpen,
    hoursWdClose: row.hoursWdClose,
    hoursSatOpen: row.hoursSatOpen,
    hoursSatClose: row.hoursSatClose,
    hoursSunOpen: row.hoursSunOpen,
    hoursSunClose: row.hoursSunClose,
    areaCities: row.areaCities,
    areaRadiusMi: row.areaRadiusMi,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt org_settings ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
