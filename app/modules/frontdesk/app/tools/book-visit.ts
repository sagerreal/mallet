import { Phone, isOk } from "@mallet/shared/types";
import type { LeadId, UserId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { JobKind } from "@mallet/jobs";
import type { OrgSettings, BookingService } from "@mallet/settings";
import { resolveServiceRequirement, meetsRequirement } from "@mallet/shared/dispatch/skill-gate";
import { sendBookingConfirmation } from "./booking-confirmation";
import {
  BOOK_LANES,
  DEFAULT_URGENCY,
  bookVisitInput,
  bookVisitParameters,
  type BookLane,
  type BookVisitInput,
  normalizeBookLane,
} from "./book-visit-input";
import {
  confirmationSpeak,
  emergencyTaskText,
  fallbackTaskText,
  flatPriceFrom,
  outOfAreaTaskText,
  slotPhrase,
} from "./book-visit-speak";
import { decorateScope } from "../found-work";
import { isInServiceArea } from "../service-area";
import { chooseCrew } from "../dispatch";
import type { GeoPoint } from "../../domain/geocoder";
import { resolveBookingPrices } from "../../domain/pricebook-price-reader";
import type { VoiceTool, VoiceToolContext, VoiceToolResult } from "./tool-result";

// Re-export the boundary contract so existing importers (tests, the route, the barrel) keep pulling
// it from ./book-visit — the schema physically lives in book-visit-input.ts to break a circular
// import and keep this file small, but its public home is unchanged.
export {
  BOOK_LANES,
  BOOK_URGENCIES,
  bookVisitInput,
  type BookLane,
  type BookLaneUrgency,
  type BookVisitInput,
} from "./book-visit-input";

// A well-formed 24-hour clock time "HH:MM" (00:00–23:59). The chosen slot_start MUST match this
// (and fall inside the org's hours) before we trust it as the scheduled start — a hallucinated
// "25:99" or "later today" is rejected at the boundary, never persisted.
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// The source stamped on every lead the voice front desk creates (matches take_message + the plan).
const VOICE_SOURCE = "AI Front Desk";

// When the org has ZERO field crew, a voice booking has no one to assign to — it stays unassigned
// and sits in the board's "To schedule" column for the office to place.
const UNASSIGNED = null;

// Minutes → hours, rounded to quarter-hours so CreateVisit's durationHours stays a sensible fraction
// (its own contract: positive, max 24). A 90-minute repair visit → 1.5h; a 30-minute scope → 0.5h.
const MINUTES_PER_HOUR = 60;
const QUARTER_HOURS_PER_HOUR = 4;
const minutesToHours = (minutes: number): number =>
  Math.round((minutes / MINUTES_PER_HOUR) * QUARTER_HOURS_PER_HOUR) / QUARTER_HOURS_PER_HOUR;

// ── Spoken lines (constants over magic strings) ─────────────────────────────────
// Functional, not chatty (house rule). The confirmation phrasing (with the ONLY sanctioned prices)
// lives in book-visit-speak.ts.

// Re-ask when the model passes a phone we can't parse. We do NOT book against a bad number.
export const BOOK_VISIT_INVALID_PHONE_SPEAK =
  "Let me get that number right — what's the best number, one digit at a time?";

// Every expected use-case failure lands here: a plain spoken fallback that promises office follow-up
// so no booking request is silently dropped (we also file a message task alongside it).
export const BOOK_VISIT_ERROR_SPEAK =
  "I hit a snag booking that — let me take a message so the office locks in your time.";

// Spoken when the geocoded address is CONFIDENTLY beyond the org's service radius. We don't book;
// we file an office callback task (below) so the lead still reaches someone — never a silent drop.
export const BOOK_VISIT_OUT_OF_AREA_SPEAK =
  "That address looks outside the area we cover — let me take a message so the office can point you to someone.";

// The job/disposition kind for a lane: anything that is not a flat price is an ESTIMATE visit —
// else → "work" (booked_job). Used for BOTH the job's kind column and result.data.kind (see
// disposition.ts). data.emergency escalates above both.
// someone goes to look before there is a price. The old repair lane booked kind='work', which is
// how a voice-booked service call rendered as priced work it never was.
const kindForLane = (lane: BookLane): JobKind => (normalizeBookLane(lane) === "estimate" ? "estimate" : "work");

// ── slot_start validation (bounds-check a model-supplied clock time) ─────────────
// slot_start is the START of the window the caller picked (from check_availability's data.slots),
// never invented. We still bounds-check it: it must be a well-formed "HH:MM" AND fall in the org's
// own [open, close) hours for that weekday, else it's rejected (→ bookingFallback) so a garbage time
// is never persisted. Once validated, scheduledStart = slot_start directly.

// The open hour for a date's weekday off the org settings. Mon–Fri → wd, Sat → sat, Sun → sun —
// the same weekday mapping slots.ts uses (UTC noon avoids any midnight/DST edge).
const openHourFor = (dateStr: string, s: OrgSettings): number => {
  const dow = weekdayOf(dateStr);
  if (dow === 0) return s.props.hoursSunOpen;
  if (dow === 6) return s.props.hoursSatOpen;
  return s.props.hoursWdOpen;
};

// The close hour for a date's weekday — mirrors openHourFor. A window start must fall in
// [openHour, closeHour); a closed day (open === close === 0) admits no start.
const closeHourFor = (dateStr: string, s: OrgSettings): number => {
  const dow = weekdayOf(dateStr);
  if (dow === 0) return s.props.hoursSunClose;
  if (dow === 6) return s.props.hoursSatClose;
  return s.props.hoursWdClose;
};

// Day of week [0=Sun … 6=Sat] for a "YYYY-MM-DD" string (UTC noon anchor — matches slots.ts).
const weekdayOf = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
};

// The integer hour of a validated "HH:MM" string.
const hourOf = (hhmm: string): number => Number(hhmm.slice(0, 2));

// True when slot_start is a well-formed "HH:MM" whose hour falls inside the org's open hours for
// slot_date's weekday. The single anti-garbage guard before we treat slot_start as scheduledStart.
//
// DELIBERATE: we bounds-check to business hours but do NOT force slot_start onto the 2-hour offer
// grid. That flexibility is what lets the agent honor a caller's specific requested time (the prompt
// still tells it to pick the containing offered window). An in-hours time the tool didn't literally
// offer is harmless — the office sees and places the visit regardless, and for a 1-3 crew shop
// exact-minute collisions aren't enforced anyway. The narrow risk (a garbage/out-of-hours time) is
// closed here; a non-grid in-hours time is an accepted, useful looseness, not a hole.
const isValidSlotStart = (input: BookVisitInput, settings: OrgSettings): boolean => {
  if (!HHMM_RE.test(input.slot_start)) return false;
  const hour = hourOf(input.slot_start);
  const open = openHourFor(input.slot_date, settings);
  const close = closeHourFor(input.slot_date, settings);
  return hour >= open && hour < close;
};

// ── Duration (from the org's configured visit minutes, never guessed) ────────────
// repair/flat → a repair visit; estimate → a scope visit. Both come from settings so the office
// controls the block length; install minutes are intentionally NOT used here (no install lane).
// A FEE visit (the old service call — tech prices it on site, likely fixes it same trip) gets the
// repair block; a free quote-first estimate gets the shorter scope block. The flag comes from the
// CONFIGURED SERVICE when one matches, never from the model's own lane claim.
const visitMinutesFor = (lane: BookLane, feeApplies: boolean, settings: OrgSettings): number => {
  if (normalizeBookLane(lane) === "flat") return settings.props.visitRepairMinutes;
  return feeApplies ? settings.props.visitRepairMinutes : settings.props.visitScopeMinutes;
};

/** The configured service's fee flag, matched by name; a stale-prompt 'repair' lane implies it. */
const feeAppliesFor = (input: { service_name: string; lane: BookLane }, settings: OrgSettings): boolean => {
  const wanted = input.service_name.trim().toLowerCase();
  const svc = settings.props.booking.services.find((s) => s.name.trim().toLowerCase() === wanted);
  if (svc) return svc.lane === "estimate" && svc.feeApplies === true;
  return input.lane === "repair";
};

// The confirmation phrasing (price provenance, slot phrase, task text) lives in book-visit-speak.ts
// so this file stays a thin orchestration gate under the file-size limit.

// The expected-failure path: file an office follow-up task so the caller isn't dropped, then speak
// the fallback. Its own errors are logged (no silent swallow) but never mask the spoken reply the
// caller is waiting on. leadId is passed when a customer was already ensured so the task links to it
// (null when EnsureCustomer itself failed). CRITICAL: the returned result carries NO `data.kind` —
// a failed booking must NOT disposition as booked_job (disposition.ts requires an explicit "work").
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

// The playbook services with pricebook-LINKED prices resolved to their CURRENT value — the ONE
// list both the persisted job line and the spoken confirmation read their flat price from, so the
// caller never hears a number different from what lands on the job. Reader absent → the stored
// playbook prices (resolveBookingPrices' own fallback). A reader FAILURE also degrades to the
// stored prices (logged, never thrown): a pricebook read hiccup must never block a booking.
const resolvedServicesFor = async (
  settings: OrgSettings,
  ctx: VoiceToolContext,
): Promise<readonly BookingService[]> => {
  try {
    return await resolveBookingPrices(settings.props.booking.services, ctx.deps.pricebookPrices);
  } catch (error: unknown) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.price_resolve_failed",
    );
    return settings.props.booking.services;
  }
};

// The priced line a FLAT booking persists on the job: the caller was quoted this exact number, so
// it lands as one quantity-1 line at the resolved price (DOLLARS in config → integer cents).
// Estimate/repair lanes NEVER get lines — money arrives with the estimate, not the visit. A flat
// name with no configured price also books priceless (the speak already falls back to the fee).
const bookedLinesFor = (
  input: BookVisitInput,
  services: readonly BookingService[],
): { description: string; quantity: number; rateCents: number }[] | undefined => {
  if (normalizeBookLane(input.lane) !== "flat") return undefined;
  const price = flatPriceFrom(input.service_name, services);
  if (price === null) return undefined;
  return [{ description: input.service_name, quantity: 1, rateCents: Math.round(price * 100) }];
};

// The org's geocoded service origin as a GeoPoint, or null when either coordinate is unset (the
// shop never set an origin, or its geocode missed on save). Null → the service-area check degrades
// to "unknown" (book normally), never a false out-of-area decline.
const originOf = (settings: OrgSettings): GeoPoint | null => {
  const { originLat, originLng } = settings.props;
  return originLat !== null && originLng !== null ? { lat: originLat, lng: originLng } : null;
};

// The CONFIDENT out-of-area path: do NOT book, but file an office callback task so the lead still
// reaches someone (no silent drop), then speak the decline. leadId is null — we short-circuit before
// ensuring a customer, so the task carries the address/problem the office needs to follow up. A task
// failure is logged, never masks the spoken decline the caller is waiting on.
const outOfAreaDecline = async (
  input: BookVisitInput,
  ctx: VoiceToolContext,
): Promise<VoiceToolResult> => {
  try {
    await ctx.deps.createTask.exec(
      { leadId: null, text: outOfAreaTaskText(input), dueDate: null },
      ctx.orgId,
    );
  } catch (error: unknown) {
    logger.error(
      { orgId: ctx.orgId, tool: "book_visit", error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.out_of_area_task_failed",
    );
  }
  return { speak: BOOK_VISIT_OUT_OF_AREA_SPEAK };
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
  jobPoint: GeoPoint | null,
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

  // Decorate the caller's scope note (found-work marker when keywords hit; null when absent/blank).
  const scope = decorateScope(input.scope_signal);

  // Resolve the cert requirement for this service from the org's booking playbook.
  // null = no requirement (service not in playbook, or playbook has no certs for it).
  const requiredCerts = resolveServiceRequirement(settings.props.booking.services, input.service_name);

  // Resolve pricebook-linked prices ONCE; the persisted flat line (below) and the spoken
  // confirmation (bottom of this function) both read from this list, so they always agree.
  const services = await resolvedServicesFor(settings, ctx);

  // Create the manual job (kind by lane). addr/phone accepted for parity but not persisted.
  // A FLAT booking carries its quoted price as a job line; every other lane books priceless.
  const job = await ctx.deps.createManualJob.exec({
    orgId: ctx.orgId,
    leadId,
    title: input.service_name,
    svc: input.service_name,
    kind: kindForLane(input.lane),
    addr: input.address,
    phone,
    notes: input.problem,
    scope,
    requiredCerts,
    lines: bookedLinesFor(input, services),
  });
  if (!isOk(job)) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: job.error.message },
      "frontdesk.book_visit.create_job_failed",
    );
    return bookingFallback(input, ctx, leadId);
  }

  // ASSIGN the booking to the least-loaded, cert-qualified field crew (tie-broken by proximity to
  // the caller's address), so the visit lands ON THE BOARD. A crew-read failure, empty roster, or
  // no qualifying crew → UNASSIGNED (null), stays in "To schedule" for the office to place.
  const assigneeUserId = await assignCrew(ctx, input.slot_date, jobPoint, requiredCerts);

  // SEED the first visit on the job (the server-side caller does this — no client flow follows).
  // scheduledStart IS the chosen window's start: slot_start was bounds-checked in `handle`
  // (isValidSlotStart), so it's a trusted in-hours "HH:MM", never an unvalidated model clock time.
  // lat/lng persist the caller's geocoded point so future proximity dispatch can measure distance.
  const visit = await ctx.deps.createVisit.exec({
    jobId: job.value.props.id,
    assigneeUserId,
    scheduledDate: input.slot_date,
    scheduledStart: input.slot_start,
    durationHours: minutesToHours(visitMinutesFor(input.lane, feeAppliesFor(input, settings), settings)),
    notes: input.problem,
    lat: jobPoint?.lat ?? null,
    lng: jobPoint?.lng ?? null,
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

  // urgency defaults to "normal" (zod fills it; a direct call with it absent is treated as normal
  // too) — only an explicit "emergency" escalates.
  const emergency = (input.urgency ?? DEFAULT_URGENCY) === "emergency";
  if (emergency) await fileEmergencyTask(input, leadId, ctx);

  logger.info(
    { orgId: ctx.orgId, tool: "book_visit", leadId, jobId, lane: input.lane, emergency },
    "frontdesk.book_visit.booked",
  );
  return {
    speak: confirmationSpeak(input, settings, slot, services),
    data: { kind: kindForLane(input.lane), emergency },
  };
};

// Pick the best-qualified, least-loaded field crew for `slotDate`, filtered by `required` cert
// tags when a requirement exists. A crew-read failure is NON-FATAL: we log it and fall back to
// UNASSIGNED so a reader hiccup never blocks a confirmed booking. When nobody qualifies
// (required is non-null but no crew holds the certs) chooseCrew returns null → UNASSIGNED —
// the booking completes normally and the office places it. Never throws.
const assignCrew = async (
  ctx: VoiceToolContext,
  slotDate: string,
  jobPoint: GeoPoint | null,
  required: readonly string[] | null,
): Promise<UserId | null> => {
  try {
    const candidates = await ctx.deps.availability.readSameDayCrewLoads(slotDate);
    const qualified = required
      ? candidates.filter((c) => meetsRequirement(c.skillTags, required))
      : candidates;
    return chooseCrew({ candidates: qualified, jobPoint });
  } catch (error: unknown) {
    logger.warn(
      { orgId: ctx.orgId, tool: "book_visit", error: error instanceof Error ? error.message : "unknown" },
      "frontdesk.book_visit.field_crew_read_failed",
    );
    return UNASSIGNED;
  }
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
    "Book the appointment after the caller picks a start time. Use for repair, estimate, or flat " +
    "services once you have name, phone, address, the service, the chosen slot_date + slot_start " +
    "(the picked start time from check_availability), and urgency. States the sanctioned " +
    "price and confirms the booking.",
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

    // Settings drive BOTH the slot_start bounds check and every sanctioned price — a known org with
    // no settings can't be booked safely, so degrade to the spoken fallback + a message task.
    const settings = await ctx.deps.settings.getByOrg(ctx.orgId);
    if (!settings) {
      logger.warn({ orgId: ctx.orgId, tool: "book_visit" }, "frontdesk.book_visit.no_settings");
      return bookingFallback(input, ctx, null);
    }

    // (2) Bounds-check the chosen slot_start: a malformed or out-of-hours time is a hallucination
    //     (never a window we offered) — degrade to the fallback, never persist a garbage start.
    if (!isValidSlotStart(input, settings)) {
      logger.warn(
        { orgId: ctx.orgId, tool: "book_visit", slotStart: input.slot_start, slotDate: input.slot_date },
        "frontdesk.book_visit.invalid_slot_start",
      );
      return bookingFallback(input, ctx, null);
    }

    // (3) Authoritative service-area check — book_visit has the FULL address (unlike
    //     check_availability's early bail). A CONFIDENT out-of-area caller (geocoded point beyond the
    //     configured radius) is declined + gets an office callback task, never booked. "in" and
    //     "unknown" (no origin / non-positive radius / geocode miss) both proceed — the check NEVER
    //     blocks a booking on missing or flaky geocoding (graceful-degrade house rule).
    const area = await isInServiceArea(
      input.address,
      originOf(settings),
      settings.props.areaRadiusMi,
      ctx.deps.geocoder,
    );
    logger.info(
      { orgId: ctx.orgId, tool: "book_visit", areaCheck: area.check },
      "frontdesk.book_visit.service_area_checked",
    );
    if (area.check === "out") return outOfAreaDecline(input, ctx);

    // (4–9) Ensure customer → job → visit → emergency task → sanctioned confirmation.
    // area.point is the caller's geocoded GeoPoint (from Phase 1's ServiceAreaResult); it drives
    // both proximity dispatch (chooseCrew) and is persisted on the visit for future proximity reads.
    return bookConfirmed(input, settings, parsed.value, ctx, area.point);
  },
};
