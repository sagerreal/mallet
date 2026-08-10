import { z } from "zod";
import { Phone } from "@mallet/shared/types";
import type { SettingsSnapshot } from "../app/get-settings";
import type { PricebookItem, LaborRate, JobTerm, LeadSource } from "../domain/settings-repository";
import type { OrgSettings } from "../domain/org-settings";

// --- Stripe Connect (Express) — PR1 -----------------------------------------

// Persisted onboarding status projected to the wire. `hasAccount` = onboarding has begun (an acct_
// id is stored); `detailsSubmitted` = the shop finished Stripe's hosted form; charges/payouts are
// the live capability flags (can lag behind detailsSubmitted during Stripe verification).
export const connectStatusDTO = z.object({
  hasAccount: z.boolean(),
  detailsSubmitted: z.boolean(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
});

export const beginOnboardingResultDTO = z.object({ url: z.string().url() });

// --- Sub-schemas -----------------------------------------------------------

/**
 * OUTPUT: two lanes only. The domain normalises the legacy "repair" lane to estimate+feeApplies
 * at its own boundary (normalizeBookingService), so a "repair" here would be a bug — the enum
 * enforces that rather than documenting it.
 */
export const bookingServiceDTO = z.object({
  name: z.string(),
  lane: z.enum(["estimate", "flat"]),
  feeApplies: z.boolean().optional(),
  price: z.number().min(0).optional(),
  pricebookServiceId: z.string().uuid().nullable().optional(),
  triggers: z.string(),
  emergencyTriggers: z.string().optional(),
  ballpark: z.string().optional(),
  requiredCerts: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

/** INPUT: additionally tolerates the legacy "repair" lane from stale clients and stored blobs —
 *  the domain maps it before anything reads it. */
export const bookingServiceInputDTO = bookingServiceDTO.extend({
  lane: z.enum(["repair", "estimate", "flat"]),
});

export const bookingCfgInputDTO = z.object({
  services: z.array(bookingServiceInputDTO),
  notServices: z.string(),
  serviceFee: z.number().min(0),
  feeCredited: z.boolean(),
  deferKeywords: z.string().optional(),
  emergencyTransferNumber: z.string().optional(),
});

export const bookingCfgDTO = z.object({
  services: z.array(bookingServiceDTO),
  notServices: z.string(),
  serviceFee: z.number().min(0), // dollars, not cents
  feeCredited: z.boolean(),
  deferKeywords: z.string().optional(),
  // Live emergency-transfer destination. ""/absent = off. VALIDATED here with the
  // shared Phone VO (fail fast at the boundary with a usable message); NORMALIZED
  // to E.164 in UpdateConfigUseCase (a zod transform would break the key's
  // optionality in the output type).
  emergencyTransferNumber: z
    .string()
    .max(24)
    .optional()
    .superRefine((v, ctx) => {
      if (v === undefined || v.trim() === "") return;
      if (!Phone.parse(v).ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a real phone number — e.g. (925) 555-0123.",
        });
      }
    }),
});

/**
 * The FIELD surface's slice of org config — two capability booleans, and nothing else.
 *
 * `settingsDTO` is owner/office only and carries booking rules, hours, service area, branding,
 * labor rates and Connect status; none of that belongs on a technician's phone. These are the
 * org CAPABILITY flags the field surface cannot work without:
 *
 *   - `measurementEstimating` gates the tech Quote tab's "Scan a room" row, and
 *     `SettingsHydrator` (the only writer of store.toggles) is office-only, so without this read
 *     a tech could never see the field scanner at all.
 *   - `canText` answers "may this org send an SMS right now" — the A2P 10DLC campaign being
 *     active. The tech job sheet shows Text beside Call on CAPABILITY rather than on role, and
 *     `v1.a2p.getStatus` (the office's source for the same fact) is ownerOrOffice, so a
 *     technician had no way to learn it. One boolean, no registration detail, no failure reason.
 *
 * Anything added here becomes readable by every technician in the org. Keep it to capability
 * flags that describe what the SHOP can do — never prices, credentials, or office configuration.
 */
export const fieldTogglesDTO = z.object({
  measurementEstimating: z.boolean(),
  canText: z.boolean(),
  /**
   * Does this shop punch a clock? False = a sheet shop: the crew types their week instead, so the
   * field surface hides the clock and leads with adding hours. A capability flag, exactly the kind
   * of fact this endpoint exists for — the office `get` is ownerOrOffice and always will be.
   */
  timesheetClock: z.boolean(),
});

/**
 * WHO billed the customer — the identity block every invoice document prints, `anyRole`.
 *
 * Same bar as `fieldTogglesDTO` and the same reason for existing: `settingsDTO` is owner/office
 * only, so the technician's close-out — which IS the customer's copy of the bill, handed over at
 * the door — had no address, no phone and no licence on it. Every field here is already printed on
 * the invoice that same customer receives by link, so a technician learning them discloses nothing.
 *
 * Anything added here becomes readable by every technician in the org. Keep it to facts that
 * appear on a customer document — never prices, credentials, or office configuration.
 */
/**
 * The shop's DEFAULT sales-tax rate, for the field quote builder — `anyRole`, one integer wide.
 *
 * Same bar as the two DTOs above and a third reason for existing. `settingsDTO` is owner/office
 * only, and the office composer seeds a new quote's Tax % from `config.taxBps` by reading it. The
 * field builder is the SAME document born on a technician's phone, so without this read a tech
 * quoting at a door either charged no tax at all or had to know his own state's rate by heart and
 * type it — and one typo becomes a figure a customer signs.
 *
 * It is org CONFIGURATION rather than a capability flag, which is why it does not join
 * fieldTogglesDTO: that contract says capability flags only, and widening it here would make the
 * next person's judgement call harder rather than easier. It is not a price and not a credential —
 * a sales-tax rate is a public statutory figure that is already printed, itemised, on every
 * invoice the technician hands the customer.
 *
 * Anything added here becomes readable by every technician in the org. Keep it to figures a
 * technician must have in hand to price a job correctly at a door.
 */
export const fieldPricingDefaultsDTO = z.object({
  taxBps: z.number().int().min(0),
});

export const businessIdentityDTO = z.object({
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  site: z.string().nullable(),
  license: z.string().nullable(),
});

// --- Org config DTO --------------------------------------------------------

export const orgSettingsDTO = z.object({
  trade: z.string(),
  markupBps: z.number().int(),
  /** The shop's DEFAULT sales-tax rate in bps (825 = 8.25%). 0 = not set. */
  taxBps: z.number().int(),
  visitScopeMinutes: z.number().int(),
  visitRepairMinutes: z.number().int(),
  visitInstallMinutes: z.number().int(),
  timesheetClock: z.boolean(),
  techSeesPrice: z.boolean(),
  techTexts: z.boolean(),
  frontDesk: z.boolean(),
  scopeOn: z.boolean(),
  autoRemind: z.boolean(),
  measurementEstimating: z.boolean(),
  hoursWdOpen: z.number().int(),
  hoursWdClose: z.number().int(),
  hoursMonOpen: z.number().int(),
  hoursMonClose: z.number().int(),
  hoursTueOpen: z.number().int(),
  hoursTueClose: z.number().int(),
  hoursWedOpen: z.number().int(),
  hoursWedClose: z.number().int(),
  hoursThuOpen: z.number().int(),
  hoursThuClose: z.number().int(),
  hoursFriOpen: z.number().int(),
  hoursFriClose: z.number().int(),
  hoursSatOpen: z.number().int(),
  hoursSatClose: z.number().int(),
  hoursSunOpen: z.number().int(),
  hoursSunClose: z.number().int(),
  timezone: z.string(),
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

// --- Business identity DTO -------------------------------------------------

/**
 * What a customer document prints about the shop, returned on every settingsDTO response.
 *
 * A sibling of brandDTO rather than part of it: brand is how the shop LOOKS (colour, monogram,
 * tagline), this is who it legally IS and how to reach it. Every field is nullable — a shop that
 * has not filled these in sends documents without those rows, never with an empty label.
 * Business name and website are NOT here; they are brandDTO.name and brandDTO.site.
 */
export const businessDTO = z.object({
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  license: z.string().nullable(),
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
  business: businessDTO,
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

/**
 * updateBusiness input: all fields optional — the caller sends only what changed, and an
 * explicit null clears a field.
 *
 * Length caps ONLY. No email regex, no phone parse, no licence pattern: these are printed on a
 * document exactly as the shop writes them, and every format rule here is a way to reject a
 * valid value. A licence number's shape varies by state and by licence class; a phone may carry
 * an extension; an "email for billing questions" may be a shared alias the shop knows works.
 * The domain trims and normalises blank to null — that is the whole of the normalisation.
 */
export const updateBusinessInput = z.object({
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  email: z.string().max(320).nullable().optional(),
  license: z.string().max(120).nullable().optional(),
});

// --- Mappers (domain → wire) -----------------------------------------------

export const toOrgSettingsDTO = (s: OrgSettings): z.infer<typeof orgSettingsDTO> => {
  const p = s.props;
  return {
    trade: p.trade,
    markupBps: p.markupBps,
    taxBps: p.taxBps,
    visitScopeMinutes: p.visitScopeMinutes,
    visitRepairMinutes: p.visitRepairMinutes,
    visitInstallMinutes: p.visitInstallMinutes,
    timesheetClock: p.timesheetClock,
    techSeesPrice: p.techSeesPrice,
    techTexts: p.techTexts,
    frontDesk: p.frontDesk,
    scopeOn: p.scopeOn,
    autoRemind: p.autoRemind,
    measurementEstimating: p.measurementEstimating,
    hoursWdOpen: p.hoursWdOpen,
    hoursWdClose: p.hoursWdClose,
    hoursMonOpen: p.hoursMonOpen,
    hoursMonClose: p.hoursMonClose,
    hoursTueOpen: p.hoursTueOpen,
    hoursTueClose: p.hoursTueClose,
    hoursWedOpen: p.hoursWedOpen,
    hoursWedClose: p.hoursWedClose,
    hoursThuOpen: p.hoursThuOpen,
    hoursThuClose: p.hoursThuClose,
    hoursFriOpen: p.hoursFriOpen,
    hoursFriClose: p.hoursFriClose,
    hoursSatOpen: p.hoursSatOpen,
    hoursSatClose: p.hoursSatClose,
    hoursSunOpen: p.hoursSunOpen,
    hoursSunClose: p.hoursSunClose,
    timezone: p.timezone,
    areaCities: p.areaCities,
    areaRadiusMi: p.areaRadiusMi,
    serviceOriginAddress: p.serviceOriginAddress,
    originLat: p.originLat,
    originLng: p.originLng,
    booking: {
      ...p.booking,
      services: p.booking.services.map((svc) => ({
        ...svc,
        // readonly string[] → string[] for the DTO type (no runtime cost).
        requiredCerts: svc.requiredCerts ? [...svc.requiredCerts] : undefined,
      })),
    },
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
 * Brand fields (how the shop looks) and business fields (who it is and how to reach it) are both
 * sourced from the OrgSettings aggregate's props; brandName mirrors orgs.name
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
    business: {
      address: p.bizAddress,
      phone: p.bizPhone,
      email: p.bizEmail,
      license: p.licenseNumber,
    },
  };
};
