import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

// Angi Lead Integration API payload (documented fields). leadOid is the stable lead id → idempotency
// key. Address arrives split; we compose a single line. Auth is a partner x-api-key header, handled
// (optionally) at the route; the per-org URL token is the primary credential.
const schema = z.object({
  name: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  primaryPhone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  stateProvince: z.string().optional(),
  postalCode: z.string().optional(),
  taskName: z.string().optional(),
  comments: z.string().optional(),
  leadOid: z.union([z.number(), z.string()]).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

function composeAddress(d: z.infer<typeof schema>): string | null {
  const street = clean(d.address);
  const region = [clean(d.city), [clean(d.stateProvince), clean(d.postalCode)].filter(Boolean).join(" ")].filter(Boolean).join(" ");
  const full = [street, region].filter(Boolean).join(", ");
  return full || null;
}

export class AngiLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid Angi payload", "body"));
    const d = parsed.data;
    const name = clean(d.name) ?? [clean(d.firstName), clean(d.lastName)].filter(Boolean).join(" ").trim();
    if (!name) return err(validation("Angi lead has no name", "name"));
    if (d.leadOid === undefined || d.leadOid === null || String(d.leadOid).trim() === "") {
      return err(validation("Angi lead has no leadOid", "leadOid"));
    }
    const notes = [clean(d.taskName), clean(d.comments)].filter(Boolean).join(" — ") || null;
    return ok({
      name: name.slice(0, 255),
      phone: clean(d.primaryPhone),
      email: clean(d.email),
      address: composeAddress(d)?.slice(0, 500) ?? null,
      notes: notes?.slice(0, 2000) ?? null,
      externalId: String(d.leadOid),
    });
  }
}
