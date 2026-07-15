import type { OrgId, Result, AppError } from "@mallet/shared/types";
import { ok, err, notFound, Phone } from "@mallet/shared/types";
import type { OrgSettings } from "@mallet/settings";
import type { LeadByPhoneReader } from "@mallet/messaging";
import type {
  SettingsReader,
  LeadSummaryReader,
  CallerContext,
  VapiAssistantDTO,
  VoiceToolSpec,
} from "../domain/assistant";
import { VOICE_MODEL, VOICE, MAX_CALL_MINUTES } from "../infra/vapi-defaults";
import { buildSystemPrompt, buildFirstMessage, type PromptFacts } from "./prompt";

const SECONDS_PER_MINUTE = 60;

// Spoken when the org has the front desk turned off. Still a valid VapiAssistantDTO — it just
// greets, offers no tools, and ends. Brand-interpolated so the caller knows who they reached.
const declineMessage = (brand: string): string =>
  `You've reached ${brand}. We can't take your call right now — please try again during ` +
  `business hours.`;

// The command the route handler passes in. fromNumber is nullable (Vapi may omit caller id) and
// may be any format — normalised via Phone.parse; unparseable is treated as an unknown caller.
export interface BuildAssistantCmd {
  readonly orgId: OrgId;
  readonly fromNumber: string | null;
}

export interface BuildAssistantDeps {
  readonly settings: SettingsReader;
  readonly leadByPhone: LeadByPhoneReader;
  readonly leadSummary: LeadSummaryReader;
}

// Projects the OrgSettings aggregate down to the narrow facts the prompt renders. No arithmetic
// on money — serviceFee and flat prices are DOLLARS carried through verbatim for speech.
const toPromptFacts = (s: OrgSettings): PromptFacts => {
  const p = s.props;
  return {
    brandName: p.brandName,
    hoursWdOpen: p.hoursWdOpen,
    hoursWdClose: p.hoursWdClose,
    hoursSatOpen: p.hoursSatOpen,
    hoursSatClose: p.hoursSatClose,
    hoursSunOpen: p.hoursSunOpen,
    hoursSunClose: p.hoursSunClose,
    areaCities: p.areaCities,
    areaRadiusMi: p.areaRadiusMi,
    notServices: p.booking.notServices,
    serviceFee: p.booking.serviceFee,
    feeCredited: p.booking.feeCredited,
    services: p.booking.services,
    deferKeywords: p.booking.deferKeywords,
  };
};

/**
 * Assembles the per-call Vapi assistant configuration from the org's playbook.
 *
 * Tools are injected once at construction (open/closed) so A5/PR B can supply the tool list
 * without touching this class. Caller recognition is at most one leadByPhone + one leadSummary
 * query (no N+1) to stay inside Vapi's ~7.5s assistant-request budget.
 */
export class BuildAssistantUseCase {
  constructor(
    private readonly deps: BuildAssistantDeps,
    private readonly tools: readonly VoiceToolSpec[],
  ) {}

  async exec(cmd: BuildAssistantCmd): Promise<Result<VapiAssistantDTO, AppError>> {
    const settings = await this.deps.settings.getByOrg(cmd.orgId);
    if (!settings) {
      return err(notFound(`no settings for org ${cmd.orgId}`));
    }

    const brand = settings.props.brandName;
    if (settings.props.frontDesk === false) {
      return ok(this.declineAssistant(brand));
    }

    const caller = await this.resolveCaller(cmd.fromNumber);
    return ok(this.fullAssistant(settings, caller));
  }

  // At most one query to each caller-recognition port; short-circuits early on any miss.
  private async resolveCaller(fromNumber: string | null): Promise<CallerContext> {
    if (fromNumber === null) return unknownCaller();

    const parsed = Phone.parse(fromNumber);
    if (!parsed.ok) return unknownCaller();

    const hit = await this.deps.leadByPhone.findLeadByPhone(parsed.value);
    if (!hit) return unknownCaller();

    const summary = await this.deps.leadSummary.summarize(hit.leadId);
    if (!summary) return unknownCaller();

    return { known: true, name: summary.name, openWork: summary.openWork };
  }

  private fullAssistant(settings: OrgSettings, caller: CallerContext): VapiAssistantDTO {
    const facts = toPromptFacts(settings);
    return {
      firstMessage: buildFirstMessage(facts.brandName),
      model: {
        provider: VOICE_MODEL.provider,
        model: VOICE_MODEL.model,
        temperature: VOICE_MODEL.temperature,
        messages: [{ role: "system", content: buildSystemPrompt({ facts, caller }) }],
        tools: this.tools,
      },
      voice: { provider: VOICE.provider, voiceId: VOICE.voiceId },
      maxDurationSeconds: MAX_CALL_MINUTES * SECONDS_PER_MINUTE,
      artifactPlan: { recordingEnabled: true },
      endCallFunctionEnabled: true,
    };
  }

  private declineAssistant(brand: string): VapiAssistantDTO {
    return {
      firstMessage: declineMessage(brand),
      model: {
        provider: VOICE_MODEL.provider,
        model: VOICE_MODEL.model,
        temperature: VOICE_MODEL.temperature,
        messages: [],
        tools: [],
      },
      voice: { provider: VOICE.provider, voiceId: VOICE.voiceId },
      maxDurationSeconds: MAX_CALL_MINUTES * SECONDS_PER_MINUTE,
      artifactPlan: { recordingEnabled: true },
      endCallFunctionEnabled: true,
    };
  }
}

const unknownCaller = (): CallerContext => ({ known: false, name: null, openWork: null });
