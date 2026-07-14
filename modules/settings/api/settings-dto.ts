import { z } from "zod";
import type { SettingsSnapshot } from "../app/get-settings";
import type { PricebookItem, LaborRate, JobTerm, LeadSource } from "../domain/settings-repository";
import type { OrgSettings } from "../domain/org-settings";

// --- Sub-schemas -----------------------------------------------------------

export const bookingServiceDTO = z.object({
  name: z.string(),
  lane: z.enum(["repair", "estimate", "flat"]),
  price: z.number().min(0).optional(),
  triggers: z.string(),
});

export const bookingCfgDTO = z.object({
  services: z.array(bookingServiceDTO),
  notServices: z.string(),
  serviceFee: z.number().min(0), // dollars, not cents
  feeCredited: z.boolean(),
});

// --- Org config DTO --------------------------------------------------------

export const orgSettingsDTO = z.object({
  trade: z.string(),
  markupBps: z.number().int(),
  visitScopeMinutes: z.number().int(),
  visitRepairMinutes: z.number().int(),
  visitInstallMinutes: z.number().int(),
  techSeesPrice: z.boolean(),
  techTexts: z.boolean(),
  frontDesk: z.boolean(),
  scopeOn: z.boolean(),
  hoursWdOpen: z.number().int(),
  hoursWdClose: z.number().int(),
  hoursSatOpen: z.number().int(),
  hoursSatClose: z.number().int(),
  hoursSunOpen: z.number().int(),
  hoursSunClose: z.number().int(),
  areaCities: z.string(),
  areaRadiusMi: z.number().int(),
  // Service origin (front-desk vertical coverage). Address the proximity is measured from,
  // plus its geocoded point. All nullable — a shop may not have set one, and a geocode miss
  // leaves lat/lng null while keeping the address.
  serviceOriginAddress: z.string().nullable(),
  originLat: z.number().nullable(),
  originLng: z.number().nullable(),
  booking: bookingCfgDTO,
});

// --- Brand DTO -------------------------------------------------------------

/**
 * Brand identity sub-object returned on every settingsDTO response.
 * name is the org display name (mirrors orgs.name); all other fields are nullable.
 */
export const brandDTO = z.object({
  name: z.string(),
  tagline: z.string().nullable(),
  site: z.string().nullable(),
  color: z.string().nullable(),
  logoUrl: z.string().nullable(),
  initials: z.string().nullable(),
});

// --- Collection item DTOs --------------------------------------------------

export const pricebookItemDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  unitPriceCents: z.number().int(),
  costCents: z.number().int(),
  position: z.number().int(),
});

// Mirrors the domain LaborRateKind union; kept as a local literal enum here so the wire
// contract doesn't import a domain type (DTO≠domain).
export const laborRateKindDTO = z.enum(["hourly", "flat_fee"]);

export const laborRateDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  rateCentsPerHour: z.number().int(),
  kind: laborRateKindDTO,
  position: z.number().int(),
});

export const jobTermDTO = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string(),
  position: z.number().int(),
});

export const leadSourceDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  position: z.number().int(),
});

// --- Snapshot (full read) --------------------------------------------------

export const settingsSnapshotDTO = z.object({
  config: orgSettingsDTO,
  pricebook: z.array(pricebookItemDTO),
  laborRates: z.array(laborRateDTO),
  terms: z.array(jobTermDTO),
  sources: z.array(leadSourceDTO),
});

// --- Full settings DTO (snapshot + brand) ----------------------------------
// Returned by updateBrand (and usable by get) so the client reconciles brand +
// config + collections in one response, avoiding a follow-up get call.

export const settingsDTO = settingsSnapshotDTO.extend({
  brand: brandDTO,
});

// --- Input schemas (named exports, mirroring output DTOs above) ------------
// These are consumed by settings-router.ts so inline anonymous z.object literals
// don't appear in the procedure chain.

export const pricebookCreateInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(500),
  unitPriceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  position: z.number().int().optional(),
});

export const pricebookUpdateInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(500).optional(),
  unitPriceCents: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).optional(),
  position: z.number().int().optional(),
});

export const laborRateCreateInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(200),
  rateCentsPerHour: z.number().int().min(0),
  kind: laborRateKindDTO.optional(),
  position: z.number().int().optional(),
});

export const laborRateUpdateInput = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(200).optional(),
  rateCentsPerHour: z.number().int().min(0).optional(),
  kind: laborRateKindDTO.optional(),
  position: z.number().int().optional(),
});

export const termCreateInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  position: z.number().int().optional(),
});

export const termUpdateInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(10_000).optional(),
  position: z.number().int().optional(),
});

export const sourceCreateInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(200),
  position: z.number().int().optional(),
});

// updateBrand input: all fields optional — caller sends only what changed.
// Boundary validation: name min(1) enforces non-blank even before the domain re-validates.
// initials hard-capped at 3 chars per UX spec; the domain aggregate intentionally
// omits this format constraint, delegating it to the boundary (design-principles §validate-at-boundaries).
export const updateBrandInput = z.object({
  name: z.string().min(1).max(200).optional(),
  tagline: z.string().max(500).nullable().optional(),
  site: z.string().max(2048).nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  logoUrl: z.string().max(2048).nullable().optional(),
  initials: z.string().max(3).nullable().optional(),
});

// --- Mappers (domain → wire) -----------------------------------------------

export const toOrgSettingsDTO = (s: OrgSettings): z.infer<typeof orgSettingsDTO> => {
  const p = s.props;
  return {
    trade: p.trade,
    markupBps: p.markupBps,
    visitScopeMinutes: p.visitScopeMinutes,
    visitRepairMinutes: p.visitRepairMinutes,
    visitInstallMinutes: p.visitInstallMinutes,
    techSeesPrice: p.techSeesPrice,
    techTexts: p.techTexts,
    frontDesk: p.frontDesk,
    scopeOn: p.scopeOn,
    hoursWdOpen: p.hoursWdOpen,
    hoursWdClose: p.hoursWdClose,
    hoursSatOpen: p.hoursSatOpen,
    hoursSatClose: p.hoursSatClose,
    hoursSunOpen: p.hoursSunOpen,
    hoursSunClose: p.hoursSunClose,
    areaCities: p.areaCities,
    areaRadiusMi: p.areaRadiusMi,
    serviceOriginAddress: p.serviceOriginAddress,
    originLat: p.originLat,
    originLng: p.originLng,
    booking: p.booking,
  };
};

export const toPricebookDTO = (i: PricebookItem): z.infer<typeof pricebookItemDTO> => ({ ...i });

export const toLaborRateDTO = (r: LaborRate): z.infer<typeof laborRateDTO> => ({ ...r });

export const toJobTermDTO = (t: JobTerm): z.infer<typeof jobTermDTO> => ({ ...t });

export const toLeadSourceDTO = (s: LeadSource): z.infer<typeof leadSourceDTO> => ({ ...s });

export const toSnapshotDTO = (s: SettingsSnapshot): z.infer<typeof settingsSnapshotDTO> => ({
  config: toOrgSettingsDTO(s.config),
  pricebook: s.pricebook.map(toPricebookDTO),
  laborRates: s.laborRates.map(toLaborRateDTO),
  terms: s.terms.map(toJobTermDTO),
  sources: s.sources.map(toLeadSourceDTO),
});

/**
 * Maps a SettingsSnapshot (config aggregate + collections) to the full settingsDTO wire shape.
 * Brand fields are sourced from the OrgSettings aggregate's props; brandName mirrors orgs.name
 * (the Drizzle repo joins orgs.name into the aggregate at read time).
 * Authoritative mapper for updateBrand — returns brand + config scalars + all four collections
 * so the client reconciles everything from a single response.
 */
export const toSettingsDTO = (s: SettingsSnapshot): z.infer<typeof settingsDTO> => {
  const p = s.config.props;
  return {
    ...toSnapshotDTO(s),
    brand: {
      name: p.brandName,
      tagline: p.brandTagline,
      site: p.brandSite,
      color: p.brandColor,
      logoUrl: p.brandLogoUrl,
      initials: p.brandInitials,
    },
  };
};
