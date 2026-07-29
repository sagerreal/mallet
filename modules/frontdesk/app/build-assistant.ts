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
  VoiceTool,
  TransferCallToolSpec,
} from "../domain/assistant";
import { VOICE_MODEL, VOICE, MAX_CALL_MINUTES } from "../infra/vapi-defaults";
import { buildSystemPrompt, buildFirstMessage, type PromptFacts } from "./prompt";
import { pickOnCall, type OnCallReader } from "../domain/on-call";

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
  /** Who may be interrupted by a caller, and their hours. Absent → escalation stays org-wide. */
  readonly onCall?: OnCallReader;
}

// Projects the OrgSettings aggregate down to the narrow facts the prompt renders. No arithmetic
// on money — serviceFee and flat prices are DOLLARS carried through verbatim for speech.
// The org's own opening hours for one weekday — the fallback for anyone with no schedule row.
// 0 = Sunday, matching JS getDay() and the crew_schedules convention.
const orgHoursForWeekday = (s: OrgSettings, weekday: number): { openHour: number; closeHour: number } => {
  const p = s.props;
  if (weekday === 0) return { openHour: p.hoursSunOpen, closeHour: p.hoursSunClose };
  if (weekday === 6) return { openHour: p.hoursSatOpen, closeHour: p.hoursSatClose };
  const wd = [
    null,
    [p.hoursMonOpen, p.hoursMonClose],
    [p.hoursTueOpen, p.hoursTueClose],
    [p.hoursWedOpen, p.hoursWedClose],
    [p.hoursThuOpen, p.hoursThuClose],
    [p.hoursFriOpen, p.hoursFriClose],
  ][weekday] as [number, number] | null;
  return wd ? { openHour: wd[0], closeHour: wd[1] } : { openHour: p.hoursWdOpen, closeHour: p.hoursWdClose };
};

const toPromptFacts = (s: OrgSettings): PromptFacts => {
  const p = s.props;
  return {
    brandName: p.brandName,
    hoursWdOpen: p.hoursWdOpen,
    hoursWdClose: p.hoursWdClose,
    hoursMonOpen: p.hoursWdOpen,
    hoursMonClose: p.hoursWdClose,
    hoursTueOpen: p.hoursWdOpen,
    hoursTueClose: p.hoursWdClose,
    hoursWedOpen: p.hoursWdOpen,
    hoursWedClose: p.hoursWdClose,
    hoursThuOpen: p.hoursWdOpen,
    hoursThuClose: p.hoursWdClose,
    hoursFriOpen: p.hoursWdOpen,
    hoursFriClose: p.hoursWdClose,
    hoursSatOpen: p.hoursSatOpen,
    hoursSatClose: p.hoursSatClose,
    hoursSunOpen: p.hoursSunOpen,
    hoursSunClose: p.hoursSunClose,
    areaRadiusMi: p.areaRadiusMi,
    notServices: p.booking.notServices,
    serviceFee: p.booking.serviceFee,
    feeCredited: p.booking.feeCredited,
    services: p.booking.services,
    deferKeywords: p.booking.deferKeywords,
    emergencyTransfer: Boolean(p.booking.emergencyTransferNumber),
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
    const onCallNumber = await this.resolveOnCall(settings, cmd.orgId);
    return ok(this.fullAssistant(settings, caller, onCallNumber));
  }

  /**
   * The phone to put an urgent caller through to right now, or null to fall back to the org's own
   * emergency number.
   *
   * "Today" and "now" are computed in the ORG's timezone. Using the server's would put a caller
   * through at 3am to someone the shop thinks is off, because a US evening is already tomorrow in
   * UTC — the same trap get_context had.
   */
  private async resolveOnCall(settings: OrgSettings, orgId: OrgId): Promise<string | null> {
    if (!this.deps.onCall) return null;

    const tz = settings.props.timezone;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hourNow = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);

    const candidates = await this.deps.onCall.findAvailable(orgId, weekday === -1 ? 0 : weekday);
    const orgHours = orgHoursForWeekday(settings, weekday === -1 ? 0 : weekday);
    return pickOnCall({ candidates, orgHours, hourNow })?.phone ?? null;
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

  private fullAssistant(settings: OrgSettings, caller: CallerContext, onCallNumber: string | null): VapiAssistantDTO {
    const facts = toPromptFacts(settings);
    // The transfer tool is PER-CALL: its destination is whoever is on shift right now, falling
    // back to the org's own emergency number when nobody is. Resolved per call rather than per org
    // because "who is on" changes hour to hour — a number baked at org level cannot express that.
    const transferNumber = onCallNumber ?? settings.props.booking.emergencyTransferNumber;
    const tools: readonly VoiceTool[] = transferNumber
      ? [...this.tools, emergencyTransferTool(transferNumber)]
      : this.tools;
    return {
      firstMessage: buildFirstMessage(facts.brandName),
      model: {
        provider: VOICE_MODEL.provider,
        model: VOICE_MODEL.model,
        temperature: VOICE_MODEL.temperature,
        messages: [{ role: "system", content: buildSystemPrompt({ facts, caller }) }],
        tools,
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

// Vapi executes this itself mid-call — the number never passes through the model
// or our webhook. Message is spoken to the caller as the bridge starts.
const emergencyTransferTool = (number: string): TransferCallToolSpec => ({
  type: "transferCall",
  destinations: [
    { type: "number", number, message: "Connecting you to the on-call line now — one moment." },
  ],
});
