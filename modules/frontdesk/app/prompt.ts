import type { ServiceLane } from "@mallet/settings";
import type { CallerContext } from "../domain/assistant";

// The playbook facts the prompt renders. A narrow projection of OrgSettings so the pure prompt
// functions never depend on the aggregate class (testable in isolation). serviceFee and flat
// prices are DOLLARS (prototype parity) — formatted for speech, never used in arithmetic.
export interface PromptService {
  readonly name: string;
  readonly lane: ServiceLane;
  readonly price?: number;
  readonly triggers: string;
}

export interface PromptFacts {
  readonly brandName: string;
  readonly hoursWdOpen: number;
  readonly hoursWdClose: number;
  readonly hoursSatOpen: number;
  readonly hoursSatClose: number;
  readonly hoursSunOpen: number;
  readonly hoursSunClose: number;
  readonly areaCities: string;
  readonly areaRadiusMi: number;
  readonly notServices: string;
  readonly serviceFee: number;
  readonly feeCredited: boolean;
  readonly services: readonly PromptService[];
}

// --- Fixed script fragments (no magic strings scattered) -----------------

const SECTIONS = {
  identity: "IDENTITY & COMPLIANCE",
  facts: "BUSINESS FACTS",
  services: "SERVICES",
  tools: "TOOLS & FLOW",
  confirm: "CONFIRM BEFORE BOOKING",
  cases: "CASE RULES",
  guardrails: "IRON GUARDRAILS",
  caller: "CALLER CONTEXT",
} as const;

// The exact tool names the runner whitelists (run-tool-calls.ts + the route's VOICE_TOOLS). These
// MUST match the tool `name` fields verbatim — the model can only trigger a tool by naming it, so a
// prompt that describes the booking flow without naming the tools would leave the whole booking
// phase inert on a live call. Keep in sync with take-message.ts / check-availability.ts /
// book-visit.ts / request-quote.ts.
export const TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookVisit: "book_visit",
  requestQuote: "request_quote",
  takeMessage: "take_message",
} as const;

// The tools-and-flow rules, named by exact tool name so the model actually CALLS them. Each line is
// a concrete "when X, CALL tool Y" instruction — no dollar amounts (the price guardrails below are
// untouched). Ordered as the booking flow runs: offer times → confirm → book → alternatives.
const TOOL_FLOW: readonly string[] = [
  `To offer appointment times, CALL ${TOOL_NAMES.checkAvailability} — it returns a few start ` +
    "times spread across the day (e.g. 8, noon, or 4). Read the options back as those start times " +
    "and let the caller pick one.",
  "If the caller names a SPECIFIC time (e.g. \"today at 2\"), offer the returned start time that " +
    "contains or is nearest that time — do not ignore their request or push a different time.",
  `Once the caller picks a start time, and ONLY after you have confirmed the details (see CONFIRM ` +
    `below), CALL ${TOOL_NAMES.bookVisit} with the chosen slot_date and slot_start (the picked ` +
    "start time, e.g. \"14:00\"), plus their name, phone, address, the service, and the " +
    "lane. It confirms the booking and speaks the sanctioned price — do not state a price yourself.",
  `If the caller only wants a written quote (a big or custom job you should not price), CALL ` +
    `${TOOL_NAMES.requestQuote} and tell them the office will call them back with a written quote.`,
  `For a reschedule, cancellation, a billing question, or "where is my tech", CALL ` +
    `${TOOL_NAMES.takeMessage} so the office handles it.`,
  "Never invent a tool result: only confirm a booking after book_visit has actually returned a " +
    "confirmation.",
] as const;

// The confirm-before-book rules. A wrong phone or a speech-to-text address slip ("Rheem"→"Green")
// must be caught BEFORE booking, so the caller hears the details read back and can correct them.
// TIGHT + SINGLE-TURN by design: one call dropped mid-confirm and booked nothing, so keep the
// confirmation to ONE short read-back and book the instant the caller says yes — the fewer/shorter
// the turns, the less the call can drift and drop before the booking is written.
const CONFIRM_RULES: readonly string[] = [
  "Confirm the details in ONE short read-back before you call book_visit — do not drag it across " +
    "several turns.",
  "In that ONE read-back: read the PHONE back as grouped digits (e.g. \"seven-eight-one… " +
    "three-five-oh…\") AND spell the street name letter-by-letter, together with the name, the " +
    'service, and the chosen start time — then ask "Is that right?".',
  "The moment the caller says yes, CALL book_visit right away — do not add filler, do not say " +
    "\"hold on\", do not re-read anything.",
  "If the caller corrects something, fix ONLY that field, re-confirm just that field, then book.",
  "NEVER call book_visit with an unconfirmed phone or address.",
  "For a returning caller, prefer the number from the caller-ID context over asking again.",
] as const;

const REPAIR_SCRIPT =
  "The tech diagnoses the problem and gives you an exact price on-site. Frame it that way — " +
  "never quote a repair price yourself. Then offer a few start times spread across the day " +
  '(e.g. "8, noon, or 4") and book the one the caller picks.';

const ESTIMATE_SCRIPT =
  "Book a free estimate visit (about 1–2 hours). Never say a job price — the estimate visit is " +
  "how we price it. Offer a few start times (e.g. 8, noon, or 4) and book the one they pick.";

const FLAT_PREFIX = "You may state exactly the listed price for this service, then book.";

const CASE_RULES: readonly string[] = [
  "Gas leak or gas smell: tell the caller to leave the building, call 911 and their gas " +
    "utility now. Do NOT book anything.",
  "Out of service area: the service area is listed in BUSINESS FACTS above (the named cities " +
    "within the stated radius). If the caller's address or city is clearly OUTSIDE that area, " +
    "politely tell them it's outside the area you cover and use take_message (offer a referral if " +
    "you can) — do NOT book an out-of-area job. When it's unclear, book normally.",
  "Emergency (flooding, sewage in the living space, no water, burst pipe): book the soonest " +
    "slot and note EMERGENCY on the booking. Coach the caller to the main shut-off valve.",
  "Existing customer wants to reschedule, cancel, ask where their tech is, or asks about " +
    "billing: use take_message so the office handles it. Never discuss billing amounts.",
  "Vendor, spam, or wrong number: end the call politely.",
  "Tenant in a rental: for non-emergency work you need landlord authorization before booking.",
  "Caller only wants a written quote: use request_quote and promise the office will call them " +
    "back with a written quote shortly.",
];

const GUARDRAILS: readonly string[] = [
  "Never say a dollar amount that is not written in this prompt or returned by a tool.",
  "Keep every reply under about 25 words.",
  "Confirm the caller's phone number digit-by-digit before booking.",
  "Read the service address back to the caller before booking.",
  // The offered start time is the front of a ~2-hour arrival window — commit to that, but don't
  // over-promise a to-the-minute arrival (this must NOT contradict offering a start time like "8am").
  "Offer and commit to a start time, but never promise a to-the-minute arrival — it's a 2-hour arrival window.",
];

// --- Price guardrail -----------------------------------------------------

// GUARDRAIL: owner-authored FREE-TEXT fields (a service's triggers, the "we don't service"
// notServices blurb, a lead's open-work label) are interpolated into the prompt VERBATIM. The
// ONLY dollar amounts the assistant is allowed to speak are the office-sanctioned serviceFee
// and flat-lane service prices, rendered by dedicated code paths below. If an owner types a
// price into any free-text field (e.g. a trigger "$50 off", notServices "septic ($500+ jobs)",
// a job titled "$500 repipe"), that stray "$NN" would smuggle an unsanctioned spoken price into
// the prompt. redactPriceTokens strips those tokens at the interpolation boundary so a $-amount
// can NEVER reach the prompt except through the sanctioned serviceFee/flat-price paths.
//
// We replace the WHOLE token (not just the "$"): deleting only the sign would leave a bare
// number that still reads as a price. A lone "$" with no digits is also stripped.

// Neutral stand-in for a redacted price token — surfaced so tests assert it exactly.
export const PRICE_REDACTION_MARKER = "[price removed]";

// Matches a dollar-amount token: "$" + optional whitespace + digits, with optional
// thousands-commas and an optional decimal part (e.g. "$50", "$ 50", "$1,250.00").
const PRICE_TOKEN_RE = /\$\s*\d[\d,]*(?:\.\d+)?/g;
// Matches a lone "$" not followed by a digit (after price tokens are gone) — e.g. "cash $ only".
const LONE_DOLLAR_RE = /\$/g;

// Pure. Removes every dollar-amount token from owner free text, leaving non-price numbers
// (e.g. "24/7", "2 hours") untouched — only "$"-prefixed tokens are affected.
export const redactPriceTokens = (text: string): string =>
  text.replace(PRICE_TOKEN_RE, PRICE_REDACTION_MARKER).replace(LONE_DOLLAR_RE, "");

// --- Helpers -------------------------------------------------------------

// A day is "closed" when open and close are both 0 (the schema's closed-day convention).
const isClosed = (open: number, close: number): boolean => open === 0 && close === 0;

// Format an integer hour [0,24] as "H:00 am/pm" for natural speech.
const formatHour = (h: number): string => {
  const suffix = h < 12 || h === 24 ? "am" : "pm";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
};

const formatDayHours = (label: string, open: number, close: number): string =>
  isClosed(open, close)
    ? `${label}: closed`
    : `${label}: ${formatHour(open)} to ${formatHour(close)}`;

const formatFeeLine = (fee: number, credited: boolean): string => {
  const base = `Service/diagnostic fee: $${fee}`;
  return credited ? `${base}, credited toward the repair if the customer goes ahead.` : `${base}.`;
};

const formatServiceLine = (s: PromptService): string => {
  // triggers is owner free text → redact stray prices; the flat-lane priceSuffix is the
  // sanctioned price and is appended AFTER redaction so it always renders.
  const priceSuffix = s.lane === "flat" && s.price !== undefined ? ` · $${s.price}` : "";
  return `- ${s.name} · ${s.lane} · ${redactPriceTokens(s.triggers)}${priceSuffix}`;
};

// --- Section builders (pure) ---------------------------------------------

const buildIdentitySection = (brand: string): string =>
  [
    `## ${SECTIONS.identity}`,
    `You are the virtual assistant answering the main phone line for ${brand}. Speak naturally, ` +
      `like a helpful front-desk coordinator — greet the caller as the business, not as a named person.`,
    // Compliance stance (see frontdesk-quote-research): we do NOT proactively announce "I am an
    // AI" (not federally required for inbound, and it hurts booking rate) — but we must never
    // deceive. Never claim to be human; disclose truthfully the moment the caller asks. Do NOT
    // volunteer that you're automated in an apology or otherwise unprompted. The recording
    // disclosure IS made up front (two-party-consent states + CIPA) via the greeting.
    "Never claim to be a specific person and never say you are human.",
    `If the caller asks whether they're talking to a real person, a machine, or AI, tell them ` +
      `honestly you're ${brand}'s automated assistant, then keep helping or offer to take a message.`,
    "The call is recorded. Be warm, brief, and get to booking. You handle intake only.",
  ].join("\n");

const buildFactsSection = (f: PromptFacts): string =>
  [
    `## ${SECTIONS.facts}`,
    "Hours:",
    formatDayHours("Weekdays", f.hoursWdOpen, f.hoursWdClose),
    formatDayHours("Saturday", f.hoursSatOpen, f.hoursSatClose),
    formatDayHours("Sunday", f.hoursSunOpen, f.hoursSunClose),
    `Service area: ${f.areaCities} (within ${f.areaRadiusMi} miles).`,
    // notServices is owner free text → redact stray prices before interpolating.
    `We do NOT service: ${redactPriceTokens(f.notServices)}. Politely decline these and suggest calling a specialist.`,
    formatFeeLine(f.serviceFee, f.feeCredited),
  ].join("\n");

const buildServicesSection = (services: readonly PromptService[]): string => {
  const lines = services.map(formatServiceLine);
  return [
    `## ${SECTIONS.services}`,
    "Each service: name · lane · triggers[ · price]. Lane tells you how to handle price:",
    ...lines,
    "",
    `repair lane: ${REPAIR_SCRIPT}`,
    `estimate lane: ${ESTIMATE_SCRIPT}`,
    `flat lane: ${FLAT_PREFIX}`,
  ].join("\n");
};

const buildToolsSection = (): string =>
  [
    `## ${SECTIONS.tools}`,
    "You have these tools. You can only DO something by calling the matching tool by name:",
    ...TOOL_FLOW.map((r) => `- ${r}`),
  ].join("\n");

const buildConfirmSection = (): string =>
  [`## ${SECTIONS.confirm}`, ...CONFIRM_RULES.map((r) => `- ${r}`)].join("\n");

const buildCaseRules = (): string =>
  [`## ${SECTIONS.cases}`, ...CASE_RULES.map((r) => `- ${r}`)].join("\n");

const buildGuardrails = (): string =>
  [`## ${SECTIONS.guardrails}`, ...GUARDRAILS.map((g) => `- ${g}`)].join("\n");

// Only rendered when caller.known — an unknown caller gets no context section at all.
const buildCallerSection = (caller: CallerContext): string => {
  // openWork is built from an owner/office-authored job label (title/svc) → redact stray
  // prices here at the guardrail boundary (e.g. a job titled "$500 repipe").
  const openWork = caller.openWork ? redactPriceTokens(caller.openWork) : "no open work on file";
  return [
    `## ${SECTIONS.caller}`,
    `This is a returning caller: ${caller.name}. Greet them by name.`,
    `Their open work: ${openWork}. Reference it naturally if relevant.`,
  ].join("\n");
};

// --- Public API ----------------------------------------------------------

// A neutral business greeting — the business answering, NOT a proactive "I am an AI" announcement
// (Owen's call; not federally required for inbound and it dents booking rate). The recording
// disclosure stays: it's the load-bearing legal piece (two-party-consent states + CIPA §631),
// and it must precede the substantive conversation. The agent discloses it's automated only when
// asked (buildIdentitySection) — never claiming to be human, so it stays non-deceptive.
export const buildFirstMessage = (brandName: string): string =>
  `Thanks for calling ${brandName}! This call may be recorded. How can I help you today?`;

export interface BuildSystemPromptInput {
  readonly facts: PromptFacts;
  readonly caller: CallerContext;
}

export const buildSystemPrompt = ({ facts, caller }: BuildSystemPromptInput): string => {
  const sections: string[] = [
    buildIdentitySection(facts.brandName),
    buildFactsSection(facts),
    buildServicesSection(facts.services),
    buildToolsSection(),
    buildConfirmSection(),
    buildCaseRules(),
    buildGuardrails(),
  ];
  if (caller.known && caller.name) sections.push(buildCallerSection(caller));
  return sections.join("\n\n");
};
