import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import type { OrgSettings } from "@mallet/settings";
import { SLOT_LOOKAHEAD_DAYS } from "../../infra/vapi-defaults";
import {
  computeSlots,
  toDateString,
  addDays,
  type OrgHours,
  type SlotWindow,
  type CrewSchedule,
} from "../slots";
import { isInServiceArea } from "../service-area";
import type { GeoPoint } from "../../domain/geocoder";
import type { CrewDaySchedule } from "../../domain/availability";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The three booking lanes (mirrors the playbook). check_availability doesn't behave differently per
// lane today — it just surfaces slots — but the model passes it so book_visit (B2) can reference the
// same lane, and the closed enum blocks a garbage value at the boundary.
export const AVAILABILITY_LANES = ["repair", "estimate", "flat"] as const;
export const AVAILABILITY_URGENCIES = ["normal", "emergency"] as const;

// Spoken lines. Functional, not chatty (house rule): each promises exactly what happens next and
// never invents a time the office can't honour. The slots the math returns are already DISCRETE
// START TIMES spread across the day (see slots.spreadOffer), so the speak is a pick-one menu of
// distinct times. 3/2 slots → a pick-one menu; 1 → offer it + the office backstop; zero → hand to
// take_message framing so no request is dropped.
const NO_SLOTS_SPEAK =
  "I don't have an opening in the next few days — let me take a message so the office can find you a time.";

// Spoken on a CONFIDENT out-of-area early bail (the caller gave a city/address the geocoder places
// beyond the org's radius) — we don't offer slots. Mirrors book_visit's decline so the caller hears
// the same message whether they're caught here or at the authoritative book_visit check.
export const CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK =
  "That address looks outside the area we cover — let me take a message so the office can point you to someone.";

export const checkAvailabilityInput = z.object({
  lane: z.enum(AVAILABILITY_LANES),
  urgency: z.enum(AVAILABILITY_URGENCIES),
  // OPTIONAL city/address for an EARLY out-of-area bail. The agent may not have the caller's location
  // yet at availability time, so this is non-breaking: omitted → no early check, slots as before. A
  // partial value ("Fresno", "123 Main St, Fresno") is enough for the Census geocoder to place it.
  service_city: z.string().optional(),
});
export type CheckAvailabilityInput = z.infer<typeof checkAvailabilityInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal so
// the model-facing contract is reviewable in one place (matches take_message's house style). Kept
// to exactly what the handler uses — a preferred_day field was parsed but never consumed (dead
// model-trust surface), so it is intentionally absent (YAGNI).
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
    service_city: {
      type: "string",
      description:
        "The caller's city or address, if you already know it — used to check they're in the " +
        "service area before offering times. Omit if you don't have it yet.",
    },
  },
  required: ["lane", "urgency"],
  additionalProperties: false,
};

// The org's geocoded service origin as a GeoPoint, or null when either coordinate is unset — mirrors
// book_visit's originOf. Null → the service-area check degrades to "unknown" (offer slots normally).
const originOf = (s: OrgSettings): GeoPoint | null => {
  const { originLat, originLng } = s.props;
  return originLat !== null && originLng !== null ? { lat: originLat, lng: originLng } : null;
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

// Compose the spoken reply from the offered start times, in ONE turn. Each `speakable` is a discrete
// day+start phrase ("today at 8am", "Thursday at noon"), already spread across the availability, so
// the caller hears genuinely different times. 3 → a three-way pick; 2 → an either/or; 1 → offer it +
// the office backstop; 0 → take_message framing. The caller then names one (or a specific time near
// it) and book_visit is called with that window's start.
const speakForSlots = (slots: readonly SlotWindow[]): string => {
  if (slots.length >= 3) {
    return `I can come ${slots[0]!.speakable}, ${slots[1]!.speakable}, or ${slots[2]!.speakable} — which works?`;
  }
  if (slots.length === 2) {
    return `I can come ${slots[0]!.speakable} or ${slots[1]!.speakable} — which works?`;
  }
  if (slots.length === 1) {
    return `I can come ${slots[0]!.speakable} — or the office can call you with more times.`;
  }
  return NO_SLOTS_SPEAK;
};

// check_availability: read the org's hours + open schedule and offer up to MAX_SLOTS DISCRETE START
// TIMES spread across the day (e.g. "8, noon, or 4") — not consecutive ranges. It never writes — the
// booking happens in book_visit (B2), which references the `data.slots` this returns (the caller
// picks a time; its startHHMM becomes book_visit's slot_start). An emergency urgency asks the slot
// math to surface today's soonest time even when the day is nearly closed.
export const checkAvailabilityTool: VoiceTool = {
  name: "check_availability",
  description:
    "Check the next open appointments and offer them to the caller. Returns up to three discrete " +
    "start times spread across the day (e.g. 8, noon, or 4), each a 2-hour arrival window. Use " +
    "once you know the caller wants to book (repair, estimate, or flat service). Emergencies see " +
    "the soonest possible time. Does not book — call book_visit after the caller picks a time " +
    "(pass that time as slot_start).",
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

    // EARLY out-of-area bail (optional): if the agent already knows the caller's city/address and the
    // geocoded point is CONFIDENTLY beyond the org's radius, decline before offering slots. "in" and
    // "unknown" (no city given / no origin / geocode miss) both fall through to the normal offer — the
    // check never blocks a caller on missing data. The authoritative check still runs in book_visit.
    if (input.service_city && input.service_city.trim().length > 0) {
      const area = await isInServiceArea(
        input.service_city,
        originOf(settings),
        settings.props.areaRadiusMi,
        ctx.deps.geocoder,
      );
      if (area.check === "out") {
        logger.info(
          { orgId: ctx.orgId, tool: "check_availability", areaCheck: "out" },
          "frontdesk.check_availability.out_of_area",
        );
        return { speak: CHECK_AVAILABILITY_OUT_OF_AREA_SPEAK, data: { slots: [] } };
      }
    }

    const now = ctx.deps.clock.now();
    // Run all three availability reads concurrently (no N+1): booked visits, field-crew ids, and
    // per-crew schedule overrides. crewCount from the snapshot is retained for logging / Task 2.3
    // reuse — it is no longer the capacity signal for the slot math.
    const [snapshot, fieldCrewIds, crewScheduleRows] = await Promise.all([
      ctx.deps.availability.read(rangeFor(now, SLOT_LOOKAHEAD_DAYS)),
      ctx.deps.availability.readFieldCrewIds(),
      ctx.deps.availability.readCrewSchedules(),
    ]);

    // Assemble per-crew schedule shapes for computeSlots. For each field-crew id, collect its
    // override rows (grouping by userId) and map to CrewWeekdayHours. A crew with no rows gets
    // { overrides: [] }, meaning "use org hours every day". Empty fieldCrewIds → crews: [] →
    // computeSlots applies the MIN_CREW clamp (same guarantee as before).
    const crews: CrewSchedule[] = buildCrewSchedules(fieldCrewIds, crewScheduleRows);

    const slots = computeSlots({
      now,
      hours: toOrgHours(settings),
      visits: snapshot.visits,
      crews,
      lookaheadDays: SLOT_LOOKAHEAD_DAYS,
      emergency: input.urgency === "emergency",
    });

    logger.info(
      {
        orgId: ctx.orgId,
        tool: "check_availability",
        lane: input.lane,
        urgency: input.urgency,
        offered: slots.length,
        fieldCrewCount: fieldCrewIds.length,
        crewCount: snapshot.crewCount, // retained for logging / Task 2.3
      },
      "frontdesk.check_availability.offered",
    );
    // `data.slots` is structured (never spoken) so book_visit / the model can reference the exact
    // date + window the caller picks.
    return { speak: speakForSlots(slots), data: { slots: slots.map(toSlotData) } };
  },
};

// Assemble one CrewSchedule per field-crew id from the raw override rows. Groups the flat
// CrewDaySchedule rows by userId, then maps each id to its override set. A crew id absent from the
// rows (no overrides configured) gets { overrides: [] } → works org hours every day.
// Pure function — no I/O, no mutation of inputs.
const buildCrewSchedules = (
  fieldCrewIds: readonly string[],
  rows: readonly CrewDaySchedule[],
): CrewSchedule[] => {
  // Index override rows by userId for O(1) lookup per crew.
  const byUserId = new Map<string, CrewDaySchedule[]>();
  for (const row of rows) {
    const bucket = byUserId.get(row.userId);
    if (bucket) bucket.push(row);
    else byUserId.set(row.userId, [row]);
  }
  return fieldCrewIds.map((id) => {
    const crewRows = byUserId.get(id) ?? [];
    return {
      overrides: crewRows.map((r) => ({
        weekday: r.weekday,
        openHour: r.openHour,
        closeHour: r.closeHour,
      })),
    };
  });
};

// The inclusive calendar-date range [today, today+lookahead] the availability reader queries. Uses
// the same local-date derivation as the slot math so the range and the windows agree.
const rangeFor = (now: Date, lookaheadDays: number): { fromDate: string; toDate: string } => {
  const from = toDateString(now);
  return { fromDate: from, toDate: addDays(from, lookaheadDays) };
};

// Structured slot echoed in `data` (plain object — the ledger stores it as JSON). Carries the exact
// window bounds so book_visit gets the EXACT chosen start (slot_start = the picked window's
// startHHMM) — no re-derivation, no morning/afternoon guessing.
const toSlotData = (s: SlotWindow): Record<string, unknown> => ({
  date: s.date,
  startHHMM: s.startHHMM,
  endHHMM: s.endHHMM,
  speakable: s.speakable,
});
