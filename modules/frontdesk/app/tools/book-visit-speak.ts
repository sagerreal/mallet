// PURE spoken/text phrasing for book_visit — the "what do we SAY / write" half of the tool, split
// out so book-visit.ts stays a thin orchestration gate under the file-size limit (many-small-files
// house rule). No I/O: every function here maps validated input + settings to a string. The price
// guardrail lives here too (the only $-amounts spoken are the sanctioned serviceFee / flat price).
import type { OrgSettings, BookingService } from "@mallet/settings";
import { redactPriceTokens } from "../prompt";
import { startTimePhrase, windowRange } from "./window-phrasing";
import type { BookVisitInput } from "./book-visit-input";

const CREDITED_SUFFIX = ", credited toward the repair if you go ahead";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Day of week [0=Sun … 6=Sat] for a "YYYY-MM-DD" string (UTC noon anchor — matches slots.ts).
const weekdayOf = (dateStr: string): number => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
};

const toDateString = (now: Date): string =>
  `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

const addOneDay = (dateStr: string): string => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchored = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12));
  anchored.setUTCDate(anchored.getUTCDate() + 1);
  return `${anchored.getUTCFullYear()}-${pad2(anchored.getUTCMonth() + 1)}-${pad2(anchored.getUTCDate())}`;
};

// "today" | "tomorrow" | a weekday name, off the calendar-date offset from `now` (same rule as B1).
const dayPhraseFor = (dateStr: string, now: Date): string => {
  const today = toDateString(now);
  if (dateStr === today) return "today";
  if (dateStr === addOneDay(today)) return "tomorrow";
  return WEEKDAY_NAMES[weekdayOf(dateStr)] ?? "that day";
};

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

// The spoken slot phrase for the confirmation: day + the DISCRETE START TIME the caller picked
// ("today at 8am", "Thursday at noon", "Friday at 4pm"). Matches the discrete start time
// check_availability offered — the caller hears the same time confirmed back, not a range.
// startTimePhrase (window-phrasing.ts) words noon/midnight naturally.
export const slotPhrase = (input: BookVisitInput, now: Date): string =>
  `${dayPhraseFor(input.slot_date, now)} at ${startTimePhrase(input.slot_start)}`;

// The arrival fragment for a flat/repair confirmation: a concrete "Someone will arrive {day} at
// {startTime}." after the sanctioned price line, so the caller hears both the price and the exact
// start time booked. `slot` = "{day} at {startTime}" (from slotPhrase).
const arrivalFragment = (slot: string): string => `Someone will arrive ${slot}.`;

// Compose the booked-confirmation line per lane. The ONLY prices spoken are serviceFee (repair /
// flat-fallback) and a matched flat service.price. estimate speaks NO price at all. `service_name`
// is RAW MODEL TEXT, so any "$NN" it smuggles (e.g. "Drain ($20 coupon)") is stripped by
// redactPriceTokens BEFORE it reaches the spoken line — the sanctioned config $price is appended
// AFTER redaction so only that one dollar amount can ever be spoken. `slot` = "{day} at {startTime}".
export const confirmationSpeak = (input: BookVisitInput, settings: OrgSettings, slot: string): string => {
  if (input.lane === "estimate") return `You're booked ${slot} for a free estimate visit.`;
  if (input.lane === "flat") {
    const price = flatPriceFor(input.service_name, settings);
    const safeName = redactPriceTokens(input.service_name);
    if (price !== null) return `${safeName} is $${price} flat. ${arrivalFragment(slot)}`;
    // No configured flat price for this name → safe fallback: state the service fee, never invent.
    return `${feeFragment(settings)} ${arrivalFragment(slot)}`;
  }
  // repair
  return `${feeFragment(settings)} ${arrivalFragment(slot)}`;
};

// The EMERGENCY office task text: the office still sees the 2-hour arrival window (windowRange) so a
// dispatcher knows the span, even though the caller was offered a discrete start time.
export const emergencyTaskText = (input: BookVisitInput): string =>
  `EMERGENCY — ${input.service_name} at ${input.address}, booked ${input.slot_date} ${windowRange(input.slot_start)}`;

export const fallbackTaskText = (input: BookVisitInput): string =>
  `Booking attempt failed — call back ${input.caller_name}${input.problem ? " re: " + input.problem : ""}`;
