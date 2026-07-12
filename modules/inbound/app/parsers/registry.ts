import type { Channel } from "../../domain/channel";
import type { LeadParser } from "../../domain/lead-parser";
import { FormLeadParser } from "./form-parser";

const PARSERS: Partial<Record<Channel, LeadParser>> = {
  form: new FormLeadParser(),
};

export function parserFor(channel: Channel): LeadParser | null {
  return PARSERS[channel] ?? null;
}
