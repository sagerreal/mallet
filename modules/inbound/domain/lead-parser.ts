import type { Result, ValidationError } from "@mallet/shared/types";
import type { NormalizedLead } from "./normalized-lead";

// One implementation per channel. Pure: raw payload → normalized lead (or a validation error).
export interface LeadParser {
  parse(payload: unknown): Result<NormalizedLead, ValidationError>;
}
