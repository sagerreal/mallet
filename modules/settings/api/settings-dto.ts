import { z } from "zod";
import type { SettingsSnapshot } from "../app/get-settings";
import type { PricebookItem, LaborRate, JobTerm, LeadSource } from "../domain/settings-repository";
import type { OrgSettings } from "../domain/org-settings";

// --- Sub-schemas -----------------------------------------------------------

export const bookingServiceDTO = z.object({
  name: z.string(),
  lane: z.enum(["repair", "estimate", "flat"]),
  price: z.number().optional(),
  triggers: z.string(),
});

export const bookingCfgDTO = z.object({
  services: z.array(bookingServiceDTO),
  notServices: z.string(),
  serviceFee: z.number(),
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
  booking: bookingCfgDTO,
});

// --- Collection item DTOs --------------------------------------------------

export const pricebookItemDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  unitPriceCents: z.number().int(),
  costCents: z.number().int(),
  position: z.number().int(),
});

export const laborRateDTO = z.object({
  id: z.string().uuid(),
  label: z.string(),
  rateCentsPerHour: z.number().int(),
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
