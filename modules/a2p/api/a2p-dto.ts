import { z } from "zod";
import { Phone } from "@mallet/shared/types";
import type { BusinessInfo } from "../domain/registration";
import type { A2pStatusView } from "../app/get-status";

// --- Status -----------------------------------------------------------------

// Mirrors the domain A2pStatus union; kept as a local literal enum here so the wire contract
// doesn't import a domain type (DTO≠domain, same convention as settings-dto's laborRateKindDTO).
export const a2pStatusDTO = z.enum([
  "not_started",
  "collecting",
  "profile_pending",
  "brand_pending",
  "campaign_pending",
  "number_pending",
  "active",
  "failed",
]);

// Projected status view returned by getStatus. Matches app/get-status.ts's A2pStatusView shape.
export const a2pStatusViewDTO = z.object({
  status: a2pStatusDTO,
  canText: z.boolean(),
  needsInput: z.boolean(),
  failureReason: z.string().nullable(),
});

// submitAndRegister's result — just the resulting status after the (possibly partial) external
// sequence runs; the client polls getStatus for the full view.
export const submitResultDTO = z.object({
  status: a2pStatusDTO,
});

// --- Business info (submitAndRegister input) --------------------------------

// Boundary validation for the collected A2P business-info form. Field-for-field mirror of the
// domain BusinessInfo interface (../domain/registration.ts) — kept as a separate DTO (DTO≠domain)
// so the wire contract can evolve independently of the aggregate's shape.
export const businessInfoDTO = z.object({
  legalName: z.string().min(1).max(200),
  // No EIN = sole proprietor (see domain's brandKind()). Null, not empty string, signals "none".
  ein: z.string().nullable(),
  addressStreet: z.string().min(1).max(500),
  addressCity: z.string().min(1).max(200),
  addressRegion: z.string().min(1).max(100),
  addressPostal: z.string().min(1).max(20),
  industry: z.string().min(1).max(100),
  websiteUrl: z.url(),
  contactFirstName: z.string().min(1).max(100),
  contactLastName: z.string().min(1).max(100),
  contactEmail: z.string().email(),
  // VALIDATED here with the shared Phone VO (fail fast at the boundary with a usable message),
  // same pattern as emergencyTransferNumber in settings-dto.ts. Left as the raw string in the DTO
  // output type (not normalized to E.164 here) — the use-case/gateway layer takes the raw
  // BusinessInfo.contactPhone string as collected.
  contactPhone: z
    .string()
    .max(24)
    .superRefine((v, ctx) => {
      if (!Phone.parse(v).ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a real phone number — e.g. (925) 555-0123.",
        });
      }
    }),
});

// --- Mappers (DTO → domain) --------------------------------------------------

export const toBusinessInfo = (dto: z.infer<typeof businessInfoDTO>): BusinessInfo => ({ ...dto });

// Re-exported purely for callers that want the view type alongside its DTO (router/tests).
export type { A2pStatusView };
