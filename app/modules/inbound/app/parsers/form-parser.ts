import { z } from "zod";
import { ok, err, validation, type Result, type ValidationError } from "@mallet/shared/types";
import type { LeadParser } from "../../domain/lead-parser";
import type { NormalizedLead } from "../../domain/normalized-lead";

const schema = z.object({
  name: z.string().max(255).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().max(320).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});
const clean = (s: string | undefined): string | null => (s?.trim() ? s.trim() : null);

export class FormLeadParser implements LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError> {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return err(validation("invalid form submission", "body"));
    const name = clean(parsed.data.name);
    if (!name) return err(validation("name is required", "name"));
    return ok({
      name,
      phone: clean(parsed.data.phone),
      email: clean(parsed.data.email),
      address: clean(parsed.data.address),
      notes: clean(parsed.data.notes),
      externalId: null,
    });
  }
}
