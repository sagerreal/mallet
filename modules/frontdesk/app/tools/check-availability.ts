import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import type { OrgSettings } from "@mallet/settings";
import { SLOT_LOOKAHEAD_DAYS } from "../../infra/vapi-defaults";
import { computeSlots, toDateString, addDays, type OrgHours, type SlotWindow } from "../slots";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The three booking lanes (mirrors the playbook). check_availability doesn't behave differently per
// lane today — it just surfaces slots — but the model passes it so book_visit (B2) can reference the
// same lane, and the closed enum blocks a garbage value at the boundary.
export const AVAILABILITY_LANES = ["repair", "estimate", "flat"] as const;
export const AVAILABILITY_URGENCIES = ["normal", "emergency"] as const;

// A shop with no member flagged is_field_crew is still one working technician (the solo owner-op),
// so capacity is at least this many crew. Prevents a mis-configured roster from making the agent
// claim it has no openings at all.
const MIN_CREW = 1;

// Spoken lines. Functional, not chatty (house rule): each promises exactly what happens next and
// never invents a time the office can't honour. Two slots → the two-slot close; one → offer it + the
// office backstop; zero → hand to take_message framing so no request is dropped.
const NO_SLOTS_SPEAK =
  "I don't have an opening in the next few days — let me take a message so the office can find you a time.";

export const checkAvailabilityInput = z.object({
  lane: z.enum(AVAILABILITY_LANES),
  urgency: z.enum(AVAILABILITY_URGENCIES),
  preferred_day: z.string().optional(),
});
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilityInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal so
// the model-facing contract is reviewable in one place (matches take_message's house style).
const checkAvailabilityParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    lane: {
      type: "string",
      enum: [...AVAILABILITY_LANES],
      description: "The booking lane for the job: repair, estimate, or flat-rate service.",
    },
    urgency: {
      type: "string",
      enum: [...AVAILABILITY_URGENCIES],
      description: "normal, or emergency for a true emergency that should be seen today.",
    },
    preferred_day: {
      type: "string",
      description: "The caller's preferred day, if they mention one (free text, e.g. 'Thursday').",
    },
  },
  required: ["lane", "urgency"],
  additionalProperties: false,
};

// Map the org's integer opening hours onto the pure OrgHours shape the slot math consumes.
const toOrgHours = (s: OrgSettings): OrgHours => {
  const p = s.props;
  return {
    wdOpen: p.hoursWdOpen,
    wdClose: p.hoursWdClose,
    satOpen: p.hoursSatOpen,
    satClose: p.hoursSatClose,
    sunOpen: p.hoursSunOpen,
    sunClose: p.hoursSunClose,
  };
};

// Compose the spoken reply from the offered slots. Two → either/or close; one → offer + office
// backstop; zero → take_message framing.
const speakForSlots = (slots: readonly SlotWindow[]): string => {
  if (slots.length >= 2) return `I've got ${slots[0]!.speakable} or ${slots[1]!.speakable} — which works?`;
  if (slots.length === 1) {
    return `I've got ${slots[0]!.speakable} — or the office can call you with more times.`;
  }
  return NO_SLOTS_SPEAK;
};

// check_availability: read the org's hours + open schedule and offer up to two windows. It never
// writes — the booking happens in book_visit (B2), which references the `data.slots` this returns.
// An emergency urgency asks the slot math to surface today even when the day is nearly closed.
export const checkAvailabilityTool: VoiceTool = {
  name: "check_availability",
  description:
    "Check the next open appointment windows and offer them to the caller. Use once you know " +
    "the caller wants to book (repair, estimate, or flat service). Emergencies see the soonest " +
    "possible time. Does not book — call book_visit after the caller picks a window.",
  parameters: checkAvailabilityParameters,
  input: checkAvailabilityInput,

  async handle(rawInput: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult> {
    // The runner already validated args against `input`; narrow the parsed value.
    const input = rawInput as CheckAvailabilityInput;

    const settings = await ctx.deps.settings.getByOrg(ctx.orgId);
    if (!settings) {
      // A known org with no settings can't have its hours read — fall back to the message framing
      // rather than invent a slot. Logged (no silent swallow).
      logger.warn({ orgId: ctx.orgId, tool: "check_availability" }, "frontdesk.check_availability.no_settings");
      return { speak: NO_SLOTS_SPEAK, data: { slots: [] } };
    }

    const now = ctx.deps.clock.now();
    const snapshot = await ctx.deps.availability.read(rangeFor(now, SLOT_LOOKAHEAD_DAYS));

    const slots = computeSlots({
      now,
      hours: toOrgHours(settings),
      visits: snapshot.visits,
      crewCount: Math.max(snapshot.crewCount, MIN_CREW),
      lookaheadDays: SLOT_LOOKAHEAD_DAYS,
      emergency: input.urgency === "emergency",
    });

    logger.info(
      { orgId: ctx.orgId, tool: "check_availability", lane: input.lane, urgency: input.urgency, offered: slots.length },
      "frontdesk.check_availability.offered",
    );
    // `data.slots` is structured (never spoken) so book_visit / the model can reference the exact
    // date + window the caller picks.
    return { speak: speakForSlots(slots), data: { slots: slots.map(toSlotData) } };
  },
};

// The inclusive calendar-date range [today, today+lookahead] the availability reader queries. Uses
// the same local-date derivation as the slot math so the range and the windows agree.
const rangeFor = (now: Date, lookaheadDays: number): { fromDate: string; toDate: string } => {
  const from = toDateString(now);
  return { fromDate: from, toDate: addDays(from, lookaheadDays) };
};

// Structured slot echoed in `data` (plain object — the ledger stores it as JSON).
const toSlotData = (s: SlotWindow): Record<string, unknown> => ({
  date: s.date,
  window: s.window,
  startHHMM: s.startHHMM,
  speakable: s.speakable,
});
