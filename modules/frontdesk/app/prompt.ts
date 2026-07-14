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
  cases: "CASE RULES",
  guardrails: "IRON GUARDRAILS",
  caller: "CALLER CONTEXT",
} as const;

const REPAIR_SCRIPT =
  "The tech diagnoses the problem and gives you an exact price on-site. Frame it that way — " +
  "never quote a repair price yourself. Then two-slot close: offer two concrete time windows " +
  '(e.g. "today 2–4 or tomorrow 8–10") and book one.';

const ESTIMATE_SCRIPT =
  "Book a free estimate visit (about 1–2 hours). Never say a job price — the estimate visit is " +
  "how we price it. Offer two windows and book one.";

const FLAT_PREFIX = "You may state exactly the listed price for this service, then book.";

const CASE_RULES: readonly string[] = [
  "Gas leak or gas smell: tell the caller to leave the building, call 911 and their gas " +
    "utility now. Do NOT book anything.",
  "Emergency (flooding, sewage in the living space, no water, burst pipe): book the soonest " +
    "slot and note EMERGENCY on the booking. Coach the caller to the main shut-off valve.",
  "Existing customer wants to reschedule, cancel, ask where their tech is, or asks about " +
    "billing: use take_message so the office handles it. Never discuss billing amounts.",
  "Vendor, spam, or wrong number: end the call politely.",
  "Tenant in a rental: for non-emergency work you need landlord authorization before booking.",
  "Caller only wants a written quote: use request_quote and promise the office will text a " +
    "written quote shortly.",
];

const GUARDRAILS: readonly string[] = [
  "Never say a dollar amount that is not written in this prompt or returned by a tool.",
  "Keep every reply under about 25 words.",
  "Confirm the caller's phone number digit-by-digit before booking.",
  "Read the service address back to the caller before booking.",
  "Never promise an exact arrival time — only the arrival window.",
];

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
  const priceSuffix = s.lane === "flat" && s.price !== undefined ? ` · $${s.price}` : "";
  return `- ${s.name} · ${s.lane} · ${s.triggers}${priceSuffix}`;
};

// --- Section builders (pure) ---------------------------------------------

const buildIdentitySection = (brand: string): string =>
  [
    `## ${SECTIONS.identity}`,
    `You are ${brand}'s AI assistant answering the phone. You already told the caller you are ` +
      `${brand}'s AI assistant and that the call is recorded.`,
    "If asked whether you are human, answer truthfully: you are an AI assistant.",
    "Be warm, brief, and get to booking. You handle intake only.",
  ].join("\n");

const buildFactsSection = (f: PromptFacts): string =>
  [
    `## ${SECTIONS.facts}`,
    "Hours:",
    formatDayHours("Weekdays", f.hoursWdOpen, f.hoursWdClose),
    formatDayHours("Saturday", f.hoursSatOpen, f.hoursSatClose),
    formatDayHours("Sunday", f.hoursSunOpen, f.hoursSunClose),
    `Service area: ${f.areaCities} (within ${f.areaRadiusMi} miles).`,
    `We do NOT service: ${f.notServices}. Politely decline these and suggest calling a specialist.`,
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

const buildCaseRules = (): string =>
  [`## ${SECTIONS.cases}`, ...CASE_RULES.map((r) => `- ${r}`)].join("\n");

const buildGuardrails = (): string =>
  [`## ${SECTIONS.guardrails}`, ...GUARDRAILS.map((g) => `- ${g}`)].join("\n");

// Only rendered when caller.known — an unknown caller gets no context section at all.
const buildCallerSection = (caller: CallerContext): string => {
  const openWork = caller.openWork ?? "no open work on file";
  return [
    `## ${SECTIONS.caller}`,
    `This is a returning caller: ${caller.name}. Greet them by name.`,
    `Their open work: ${openWork}. Reference it naturally if relevant.`,
  ].join("\n");
};

// --- Public API ----------------------------------------------------------

export const buildFirstMessage = (brandName: string): string =>
  `Thanks for calling ${brandName}. You're speaking with ${brandName}'s AI assistant — ` +
  `this call is recorded. How can I help?`;

export interface BuildSystemPromptInput {
  readonly facts: PromptFacts;
  readonly caller: CallerContext;
}

export const buildSystemPrompt = ({ facts, caller }: BuildSystemPromptInput): string => {
  const sections: string[] = [
    buildIdentitySection(facts.brandName),
    buildFactsSection(facts),
    buildServicesSection(facts.services),
    buildCaseRules(),
    buildGuardrails(),
  ];
  if (caller.known && caller.name) sections.push(buildCallerSection(caller));
  return sections.join("\n\n");
};
