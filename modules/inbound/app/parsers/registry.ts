import type { Channel } from "../../domain/channel";
import type { LeadParser } from "../../domain/lead-parser";
import { FormLeadParser } from "./form-parser";
import { AngiLeadParser } from "./angi-parser";
import { ThumbtackLeadParser } from "./thumbtack-parser";

const PARSERS: Partial<Record<Channel, LeadParser>> = {
  form: new FormLeadParser(),
  angi: new AngiLeadParser(),
  thumbtack: new ThumbtackLeadParser(),
};

export function parserFor(channel: Channel): LeadParser | null {
  return PARSERS[channel] ?? null;
}
