import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

// Thumbtack Leads API payload. leadID is the stable id → idempotency key. Thumbtack does NOT provide
// email. Phone is documented on the customer; some payloads place it at the top level — tolerate both.
// Address is composed from request.location. The per-org URL token is the credential.
const schema = z.object({
  leadID: z.union([z.string(), z.number()]).optional(),
  phone: z.string().optional(),
  customer: z.object({ name: z.string().optional(), phone: z.string().optional() }).optional(),
  request: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    location: z.object({ city: z.string().optional(), state: z.string().optional(), zipCode: z.string().optional() }).optional(),
  }).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

function composeAddress(loc: { city?: string; state?: string; zipCode?: string } | undefined): string | null {
  if (!loc) return null;
  const region = [clean(loc.state), clean(loc.zipCode)].filter(Boolean).join(" ");
  return [clean(loc.city), region].filter(Boolean).join(" ") || null;
}

export class ThumbtackLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid Thumbtack payload", "body"));
    const d = parsed.data;
    const name = clean(d.customer?.name);
    if (!name) return err(validation("Thumbtack lead has no customer name", "name"));
    if (d.leadID === undefined || d.leadID === null || String(d.leadID).trim() === "") {
      return err(validation("Thumbtack lead has no leadID", "leadID"));
    }
    const address = composeAddress(d.request?.location);
    const notes = [clean(d.request?.title), clean(d.request?.description)].filter(Boolean).join(" — ") || null;
    return ok({
      name: name.slice(0, 255),
      phone: clean(d.customer?.phone) ?? clean(d.phone),
      email: null,
      address: address?.slice(0, 500) ?? null,
      notes: notes?.slice(0, 2000) ?? null,
      externalId: String(d.leadID),
    });
  }
}
