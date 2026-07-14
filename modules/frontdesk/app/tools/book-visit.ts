import { z } from "zod";
import { Phone, isOk } from "@mallet/shared/types";
import type { LeadId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { JobKind } from "@mallet/jobs";
import type { OrgSettings, BookingService } from "@mallet/settings";
import { WINDOW_BOUNDARY_HOUR } from "../slots";
import { sendBookingConfirmation } from "./booking-confirmation";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// The three booking lanes + urgencies (mirror check_availability's closed enums so the model can't
// smuggle a garbage lane past the boundary). repair/flat book a work job; estimate books a scope
// visit as an estimate-kind job so it rides the board unchanged.
export const BOOK_LANES = ["repair", "estimate", "flat"] as const;
export type BookLane = (typeof BOOK_LANES)[number];
export const BOOK_URGENCIES = ["normal", "emergency"] as const;
export const BOOK_WINDOWS = ["morning", "afternoon"] as const;

// The source stamped on every lead the voice front desk creates (matches take_message + the plan).
const VOICE_SOURCE = "AI Front Desk";

// The assignee is never chosen on a voice booking — the office/board places the visit onto a crew.
const UNASSIGNED = null;

// Minutes → hours, rounded to quarter-hours so CreateVisit's durationHours stays a sensible fraction
// (its own contract: positive, max 24). A 90-minute repair visit → 1.5h; a 30-minute scope → 0.5h.
const MINUTES_PER_HOUR = 60;
const QUARTER_HOURS_PER_HOUR = 4;
const minutesToHours = (minutes: number): number =>
  Math.round((minutes / MINUTES_PER_HOUR) * QUARTER_HOURS_PER_HOUR) / QUARTER_HOURS_PER_HOUR;

// ── Spoken lines (constants over magic strings) ─────────────────────────────────
// Functional, not chatty (house rule). The booking-confirmation lines are the ONLY place a booked
// price is stated — its provenance is the org's configured serviceFee / flat service.price, never a
// model-supplied or invented number.

// Re-ask when the model passes a phone we can't parse. We do NOT book against a bad number.
export const BOOK_VISIT_INVALID_PHONE_SPEAK =
  "Let me get that number right — what's the best number, one digit at a time?";

// Every expected use-case failure lands here: a plain spoken fallback that promises office follow-up
// so no booking request is silently dropped (we also file a message task alongside it).
export const BOOK_VISIT_ERROR_SPEAK =
  "I hit a snag booking that — let me take a message so the office locks in your time.";

const CREDITED_SUFFIX = ", credited toward the repair if you go ahead";

// ── Input schema (validated at the boundary by the runner before handle runs) ────

export const bookVisitInput = z.object({
  caller_name: z.string().min(1),
  phone: z.string(),
  address: z.string(),
  service_name: z.string().min(1),
  lane: z.enum(BOOK_LANES),
  problem: z.string(),
  slot_date: z.string(),
  slot_window: z.enum(BOOK_WINDOWS),
  urgency: z.enum(BOOK_URGENCIES),
});
export type BookVisitInput = z.infer<typeof bookVisitInput>;

// The JSON schema Vapi forwards to the LLM (VoiceToolSpec.function.parameters). Explicit literal so
// the model-facing contract is reviewable in one place (matches the house style of the other tools).
const bookVisitParameters: Record<string, unknown> = {
  type: "object",
  properties: {
    caller_name: { type: "string", description: "The caller's full name." },
    phone: { type: "string", description: "The caller's callback number, confirmed digit-by-digit." },
    address: { type: "string", description: "The service address, read back to the caller." },
    service_name: { type: "string", description: "The service being booked (from the playbook)." },
    lane: {
      type: "string",
      enum: [...BOOK_LANES],
      description: "repair, estimate, or flat — the playbook lane for this service.",
    },
    problem: { type: "string", description: "What the caller described in their own words." },
    slot_date: { type: "string", description: 'The chosen slot date, "YYYY-MM-DD".' },
    slot_window: {
      type: "string",
      enum: [...BOOK_WINDOWS],
      description: "The chosen window: morning or afternoon.",
    },
    urgency: {
      type: "string",
      enum: [...BOOK_URGENCIES],
      description: "normal, or emergency for a true emergency booked ASAP.",
    },
  },
  required: ["caller_name", "phone", "address", "service_name", "lane", "slot_date", "slot_window"],
  additionalProperties: false,
};

// The job/disposition kind for a lane: estimate lane → "estimate" (booked_estimate), everything
// else → "work" (booked_job). Used for BOTH the job's kind column and result.data.kind (see
// disposition.ts). data.emergency escalates above both.
const kindForLane = (lane: BookLane): JobKind => (lane === "estimate" ? "estimate" : "work");

// ── Window-start derivation (NEVER a model-supplied clock time) ──────────────────
// The scheduled start comes from slot_window + the org's own hours, derived the SAME way B1's slot
// math does: a morning window starts at that weekday's OPEN hour; an afternoon window starts at the
// 13:00 WINDOW_BOUNDARY_HOUR. This is the anti-prompt-injection guard — the model tells us the
// window, the org's config tells us the clock time.

// The open hour for a date's weekday off the org settings. Mon–Fri → wd, Sat → sat, Sun → sun —
// the same weekday mapping slots.ts uses (UTC noon avoids any midnight/DST edge).
const openHourFor = (dateStr: string, s: OrgSettings): number => {
  const dow = weekdayOf(dateStr);
  if (dow === 0) return s.props.hoursSunOpen;
  if (dow === 6) return s.props.hoursSatOpen;
  return s.props.hoursWdOpen;
};

// Day of week [0=Sun … 6=Sat] for a "YYYY-MM-DD" string (UTC noon anchor — matches slots.ts).
const weekdayOf = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
};

const pad2 = (n: number): string => String(n).padStart(2, "0");
const toHHMM = (hour: number): string => `${pad2(hour)}:00`;

// "HH:MM" start for a window: morning → the weekday's open hour; afternoon → the 13:00 boundary.
const scheduledStartFor = (input: BookVisitInput, settings: OrgSettings): string =>
  input.slot_window === "afternoon"
    ? toHHMM(WINDOW_BOUNDARY_HOUR)
    : toHHMM(openHourFor(input.slot_date, settings));

// ── Duration (from the org's configured visit minutes, never guessed) ────────────
// repair/flat → a repair visit; estimate → a scope visit. Both come from settings so the office
// controls the block length; install minutes are intentionally NOT used here (no install lane).
const visitMinutesFor = (lane: BookLane, settings: OrgSettings): number =>
  lane === "estimate" ? settings.props.visitScopeMinutes : settings.props.visitRepairMinutes;

// ── Price provenance (config ONLY — never a model-invented amount) ───────────────

// The configured flat price for a service_name, or null when no flat service matches (case-
// insensitive, trimmed). A null result means the model named something with no configured flat
// price — we then state the service fee, never an invented number.
const flatPriceFor = (serviceName: string, settings: OrgSettings): number | null => {
  const wanted = serviceName.trim().toLowerCase();
  const match = settings.props.booking.services.find(
    (svc: BookingService) => svc.lane === "flat" && svc.name.trim().toLowerCase() === wanted,
  );
  return match?.price ?? null;
};

// The service-fee fragment ("The visit is $89[, credited …].") — the repair-lane provenance, also
// the safe fallback for a flat service with no configured price.
const feeFragment = (settings: OrgSettings): string => {
  const { serviceFee, feeCredited } = settings.props.booking;
  return `The visit is $${serviceFee}${feeCredited ? CREDITED_SUFFIX : ""}.`;
};

// The spoken slot phrase for the confirmation ("Thursday morning", "today afternoon"). Small local
// helper (slots.ts's speakableFor is private) — kept terse to match the two-slot-close voice.
const slotPhrase = (input: BookVisitInput, now: Date): string =>
  `${dayPhraseFor(input.slot_date, now)} ${input.slot_window}`;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// "today" | "tomorrow" | a weekday name, off the calendar-date offset from `now` (same rule as B1).
const dayPhraseFor = (dateStr: string, now: Date): string => {
  const today = toDateString(now);
  if (dateStr === today) return "today";
  if (dateStr === addOneDay(today)) return "tomorrow";
  return WEEKDAY_NAMES[weekdayOf(dateStr)] ?? "that day";
};

const toDateString = (now: Date): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const addOneDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchored = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12));
  anchored.setUTCDate(anchored.getUTCDate() + 1);
  return `${anchored.getUTCFullYear()}-${pad2(anchored.getUTCMonth() + 1)}-${pad2(anchored.getUTCDate())}`;
};

// Compose the booked-confirmation line per lane. The ONLY prices spoken are serviceFee (repair /
// flat-fallback) and a matched flat service.price. estimate speaks NO price at all.
const confirmationSpeak = (input: BookVisitInput, settings: OrgSettings, slot: string): string => {
  if (input.lane === "estimate") return `You're booked ${slot} for a free estimate visit.`;
  if (input.lane === "flat") {
    const price = flatPriceFor(input.service_name, settings);
    if (price !== null) return `You're booked ${slot}. ${input.service_name} is $${price} flat.`;
    // No configured flat price for this name → safe fallback: state the service fee, never invent.
    return `You're booked ${slot}. ${feeFragment(settings)}`;
  }
  // repair
  return `You're booked ${slot}. ${feeFragment(settings)}`;
};

const emergencyTaskText = (input: BookVisitInput): string =>
  `EMERGENCY — ${input.service_name} at ${input.address}, booked ${input.slot_date} ${input.slot_window}`;

const fallbackTaskText = (input: BookVisitInput): string =>
  `AI call — booking failed, needs office follow-up: ${input.service_name} at ${input.address}`;

// The expected-failure path: file a message task so the office locks in the time, then speak the
// fallback. Its own errors are logged (no silent swallow) but never mask the spoken reply the caller
// is waiting on. leadId is passed when a customer was already ensured so the task links to it.
const bookingFallback = async (
  input: BookVisitInput,
  ctx: VoiceToolContext,
  leadId: LeadId | null,
): Promise<VoiceToolResult> => {
  try {
    await ctx.deps.createTask.exec(
      { leadId, text: fallbackTaskText(input), dueDate: null },
      ctx.orgId,
    );
  } catch (error: unknown) {
    logger.error(
      { orgId: ctx.orgId, tool: "book_visit", error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.fallback_task_failed",
    );
  }
  return { speak: BOOK_VISIT_ERROR_SPEAK };
};

// The core booking sequence, run once the phone is valid and settings are loaded: ensure the
// customer → create the job (kind by lane) → seed its first visit → file an EMERGENCY task when
// urgent. Any expected use-case failure returns the spoken fallback (with a message task). Kept a
// standalone helper so `handle` stays a thin gate and this stays under the function-size limit.
const bookConfirmed = async (
  input: BookVisitInput,
  settings: OrgSettings,
  phone: Phone,
  ctx: VoiceToolContext,
): Promise<VoiceToolResult> => {
  // Ensure the customer (get-or-create, deduped on phone).
  const ensured = await ctx.deps.ensureCustomer.exec({
    name: input.caller_name,
    phone,
    email: null,
    source: VOICE_SOURCE,
    companyId: null,
    role: null,
    notes: input.problem,
    address: input.address,
  });
  if (!isOk(ensured)) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: ensured.error.message },
      "frontdesk.book_visit.ensure_customer_failed",
    );
    return bookingFallback(input, ctx, null);
  }
  const leadId = ensured.value.lead.props.id;

  // Create the manual job (kind by lane). addr/phone accepted for parity but not persisted.
  const job = await ctx.deps.createManualJob.exec({
    orgId: ctx.orgId,
    leadId,
    title: input.service_name,
    svc: input.service_name,
    kind: kindForLane(input.lane),
    addr: input.address,
    phone,
    notes: input.problem,
  });
  if (!isOk(job)) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: job.error.message },
      "frontdesk.book_visit.create_job_failed",
    );
    return bookingFallback(input, ctx, leadId);
  }

  // SEED the first visit on the job (the server-side caller does this — no client flow follows).
  // scheduledStart is derived from the window + org hours, NEVER a model-supplied clock time.
  const visit = await ctx.deps.createVisit.exec({
    jobId: job.value.props.id,
    assigneeUserId: UNASSIGNED,
    scheduledDate: input.slot_date,
    scheduledStart: scheduledStartFor(input, settings),
    durationHours: minutesToHours(visitMinutesFor(input.lane, settings)),
    notes: input.problem,
  });
  if (!isOk(visit)) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: visit.error.message },
      "frontdesk.book_visit.create_visit_failed",
    );
    return bookingFallback(input, ctx, leadId);
  }

  // The booking has succeeded — the confirmation SMS is a best-effort background step from here on.
  const slot = slotPhrase(input, ctx.deps.clock.now());
  const jobId = job.value.props.id;
  await sendBookingConfirmation(jobId, phone, settings.props.brandName, slot, ctx);

  const emergency = input.urgency === "emergency";
  if (emergency) await fileEmergencyTask(input, leadId, ctx);

  logger.info(
    { orgId: ctx.orgId, tool: "book_visit", leadId, jobId, lane: input.lane, emergency },
    "frontdesk.book_visit.booked",
  );
  return {
    speak: confirmationSpeak(input, settings, slot),
    data: { kind: kindForLane(input.lane), emergency },
  };
};

// File the EMERGENCY office task and flag it so the call dispositions as emergency (highest
// precedence in disposition.ts). The booking already succeeded — a task failure is logged, never
// fatal to the confirmed booking.
const fileEmergencyTask = async (
  input: BookVisitInput,
  leadId: LeadId,
  ctx: VoiceToolContext,
): Promise<void> => {
  const task = await ctx.deps.createTask.exec(
    { leadId, text: emergencyTaskText(input), dueDate: null },
    ctx.orgId,
  );
  if (!isOk(task)) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: task.error.message },
      "frontdesk.book_visit.emergency_task_failed",
    );
  }
};

// ── The tool ─────────────────────────────────────────────────────────────────────

// book_visit: the caller has picked a window (via check_availability) and is ready to book. Ensures
// the customer, creates the job (kind by lane), SEEDS the first visit itself (no client flow follows
// a voice booking — per CreateManualJobUseCase's comment), files an EMERGENCY task when urgent, and
// speaks the sanctioned price. Expected failures return a spoken fallback + a message task rather
// than throw — the caller always hears a coherent reply and the office always gets the lead.
export const bookVisitTool: VoiceTool = {
  name: "book_visit",
  description:
    "Book the appointment after the caller picks a window. Use for repair, estimate, or flat " +
    "services once you have name, phone, address, the service, the chosen date + window, and " +
    "urgency. States the sanctioned price and confirms the booking.",
  parameters: bookVisitParameters,
  input: bookVisitInput,

  async handle(rawInput: unknown, ctx: VoiceToolContext): Promise<VoiceToolResult> {
    const input = rawInput as BookVisitInput;

    // (1) A bad number blocks booking — re-ask rather than book against garbage. No task filed:
    //     the agent simply re-confirms the digits and calls book_visit again.
    const parsed = Phone.parse(input.phone);
    if (!isOk(parsed)) {
      logger.info({ orgId: ctx.orgId, tool: "book_visit" }, "frontdesk.book_visit.invalid_phone");
      return { speak: BOOK_VISIT_INVALID_PHONE_SPEAK };
    }

    // Settings drive BOTH the window-start clock time and every sanctioned price — a known org with
    // no settings can't be booked safely, so degrade to the spoken fallback + a message task.
    const settings = await ctx.deps.settings.getByOrg(ctx.orgId);
    if (!settings) {
      logger.warn({ orgId: ctx.orgId, tool: "book_visit" }, "frontdesk.book_visit.no_settings");
      return bookingFallback(input, ctx, null);
    }

    // (2–7) Ensure customer → job → visit → emergency task → sanctioned confirmation.
    return bookConfirmed(input, settings, parsed.value, ctx);
  },
};
