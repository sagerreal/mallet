import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  buildFirstMessage,
  redactPriceTokens,
  PRICE_REDACTION_MARKER,
  TOOL_NAMES,
} from "./prompt";
import type { PromptFacts } from "./prompt";
import type { CallerContext } from "../domain/assistant";

// A complete, realistic playbook the prompt renders. Tests override individual fields.
const baseFacts = (o: Partial<PromptFacts> = {}): PromptFacts => ({
  brandName: "Bayline Plumbing",
  hoursWdOpen: 8,
  hoursWdClose: 17,
  hoursSatOpen: 9,
  hoursSatClose: 13,
  hoursSunOpen: 0,
  hoursSunClose: 0,
  areaCities: "Pleasanton, Dublin",
  areaRadiusMi: 25,
  notServices: "septic tanks, well pumps",
  serviceFee: 89,
  feeCredited: true,
  services: [
    { name: "Drain cleaning", lane: "flat", price: 149, triggers: "clogged drain, slow drain" },
    { name: "Faucet repair", lane: "repair", triggers: "leaky faucet, dripping" },
    { name: "Water heater replacement", lane: "estimate", triggers: "no hot water, old heater" },
  ],
  ...o,
});

const unknownCaller: CallerContext = { known: false, name: null, openWork: null };
const knownCaller: CallerContext = {
  known: true,
  name: "Dana Ruiz",
  openWork: "job #142 scheduled Jul 16 (drain clear)",
};

// The only dollar amounts allowed to appear anywhere in the prompt: the configured serviceFee
// and every flat-lane price. Any other "$N" is a price-guardrail violation. Thousands separators
// are matched only between digit groups so a trailing sentence comma is never captured.
const dollarTokens = (text: string): string[] => text.match(/\$\d+(?:,\d{3})*/g) ?? [];

// The set of dollar tokens the prompt is ALLOWED to contain for a given playbook: the
// serviceFee plus every flat-lane price plus ballpark figures (which are sanctioned owner-authored
// prices rendered verbatim). Everything else is a guardrail violation.
const allowedTokens = (facts: PromptFacts): Set<string> => {
  const tokens = new Set<string>([`$${facts.serviceFee}`]);
  for (const s of facts.services) {
    if (s.lane === "flat" && s.price !== undefined) tokens.add(`$${s.price}`);
    // ballpark figures are sanctioned owner-authored prices → allowed in the prompt
    if (s.ballpark) {
      const ballparkMatches = s.ballpark.match(/\$\d+(?:,\d{3})*/g) ?? [];
      for (const token of ballparkMatches) tokens.add(token);
    }
  }
  return tokens;
};

describe("buildFirstMessage", () => {
  it("is a neutral business greeting with the recording disclosure and brand interpolated", () => {
    expect(buildFirstMessage("Bayline Plumbing")).toBe(
      "Thanks for calling Bayline Plumbing! This call may be recorded. How can I help you today?",
    );
  });

  it("does NOT proactively announce it is an AI (disclosure is on-request only)", () => {
    expect(buildFirstMessage("Bayline Plumbing")).not.toMatch(/\bAI\b|assistant|automated|bot/i);
  });
});

describe("buildSystemPrompt — identity & compliance", () => {
  it("keeps the recording disclosure and names the brand, without impersonating a human", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/recorded/i);
    expect(p).toMatch(/Bayline Plumbing/);
    // never claim to be human / a named person
    expect(p).toMatch(/never say you are human|never claim to be a specific person/i);
    // disclose truthfully ON REQUEST (not proactively)
    expect(p).toMatch(/if the caller asks.*(real person|machine|AI)/i);
    expect(p).toMatch(/automated assistant/i);
  });
});

describe("buildSystemPrompt — business facts", () => {
  it("renders weekday/Saturday/Sunday hours and the service area", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/8:00.*5:00|8.*17|8 am|8:00/i);
    expect(p).toMatch(/Pleasanton, Dublin/);
    expect(p).toMatch(/25/); // radius
  });

  it("declines notServices politely and suggests a specialist", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/septic tanks, well pumps/);
    expect(p).toMatch(/specialist/i);
  });

  it("renders the service fee with credited phrasing when feeCredited is true", () => {
    const p = buildSystemPrompt({ facts: baseFacts({ feeCredited: true }), caller: unknownCaller });
    expect(p).toContain("$89");
    expect(p).toMatch(/credited/i);
  });

  it("renders the service fee WITHOUT credited phrasing when feeCredited is false", () => {
    const p = buildSystemPrompt({
      facts: baseFacts({ feeCredited: false }),
      caller: unknownCaller,
    });
    expect(p).toContain("$89");
    expect(p).not.toMatch(/credited/i);
  });
});

describe("buildSystemPrompt — services table & lane scripts", () => {
  it("renders a FLAT service's exact price", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toContain("Drain cleaning");
    expect(p).toContain("$149");
  });

  it("renders a REPAIR service with NO price", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // Faucet repair line must not carry a dollar amount.
    const faucetLine = p.split("\n").find((l) => l.includes("Faucet repair")) ?? "";
    expect(faucetLine).not.toMatch(/\$\d/);
  });

  it("includes the repair fee-credit framing and a discrete start-time close", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/exact price on-site|diagnoses/i);
    // the close now offers a few discrete START TIMES spread across the day, not consecutive ranges
    expect(p).toMatch(/start times/i);
    expect(p).toMatch(/8, noon, or 4/);
  });

  it("frames the estimate lane as a free estimate visit", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/free estimate/i);
  });
});

describe("buildSystemPrompt — tools & flow", () => {
  it("names every booking tool by its exact tool name so the model actually calls them", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // Each tool must appear by its EXACT name — a prompt that describes the flow without naming
    // the tools leaves the booking phase inert (the model can only trigger a tool by name).
    expect(p).toContain(TOOL_NAMES.checkAvailability);
    expect(p).toContain(TOOL_NAMES.bookVisit);
    expect(p).toContain(TOOL_NAMES.requestQuote);
    expect(p).toContain(TOOL_NAMES.takeMessage);
  });

  it("teaches the offer-then-book flow: check_availability returns a few start times, book_visit takes slot_start", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // check_availability offers a few discrete start times spread across the day; book_visit takes
    // slot_date + slot_start (the picked start time).
    expect(p).toMatch(/check_availability[\s\S]*start times/i);
    expect(p).toMatch(/8, noon, or 4/);
    expect(p).toMatch(/book_visit[\s\S]*slot_date[\s\S]*slot_start/i);
    // slot_window is gone from the flow.
    expect(p).not.toMatch(/slot_window/);
    // the offer is discrete start times, not consecutive 2-hour ranges
    expect(p).not.toMatch(/2-hour arrival windows/);
  });

  it("tells the model to honour a specific requested time by offering the containing/nearest start", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/specific time/i);
    expect(p).toMatch(/contains or is nearest|contains that time|nearest that time/i);
  });

  it("keeps the tools section free of any dollar amount (guardrail intact)", () => {
    const facts = baseFacts();
    const p = buildSystemPrompt({ facts, caller: knownCaller });
    const toolsSection = p.split("## ").find((s) => s.startsWith("TOOLS & FLOW")) ?? "";
    expect(toolsSection).not.toMatch(/\$\d/);
  });

  it("includes the scope question guidance (anything else you've noticed / scope_signal)", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const toolsSection = p.split("## ").find((s) => s.startsWith("TOOLS & FLOW")) ?? "";
    // The agent must be instructed to ask the brief scope question before confirm + booking.
    expect(toolsSection).toMatch(/anything else you've noticed/i);
    expect(toolsSection).toMatch(/scope_signal/);
    // Still no dollar amounts in the tools section (price guardrail unaffected).
    expect(toolsSection).not.toMatch(/\$\d/);
  });
});

describe("buildSystemPrompt — confirm before booking", () => {
  it("requires reading the phone back as grouped digits and spelling the street letter-by-letter", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/grouped digits|read the phone back/i);
    expect(p).toMatch(/spell the street|letter-by-letter/i);
  });

  it('reads the details back in ONE short read-back and asks "Is that right?"', () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // tightened: a single, concise read-back (not several turns) so the call can't drift mid-confirm
    expect(p).toMatch(/one short read-back|ONE short read-back/i);
    expect(p).toMatch(/is that right\?/i);
    // the read-back still covers name + service + chosen start time
    expect(p).toMatch(/the name, the service/i);
    expect(p).toMatch(/chosen start time/i);
  });

  it("books IMMEDIATELY on yes — no filler, no stall — so the call can't drop mid-confirm", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/the moment the caller says yes/i);
    expect(p).toMatch(/CALL book_visit right away/i);
    expect(p).toMatch(/do not add filler|do not say .*hold on|do not.*stall/i);
  });

  it("corrects only the wrong field and re-confirms, and never books unconfirmed details", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/fix ONLY that field|correct/i);
    expect(p).toMatch(/never call book_visit with an unconfirmed/i);
  });

  it("prefers the caller-ID number for a returning caller", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/returning caller.*caller-ID|caller-ID context/i);
  });

  it("keeps the confirm section free of any dollar amount (guardrail intact)", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: knownCaller });
    const confirmSection = p.split("## ").find((s) => s.startsWith("CONFIRM BEFORE BOOKING")) ?? "";
    expect(confirmSection).not.toMatch(/\$\d/);
  });
});

describe("buildSystemPrompt — case rules", () => {
  it("covers gas leak → 911 + gas utility, no booking", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/gas (leak|smell)/i);
    expect(p).toMatch(/911/);
    expect(p).toMatch(/gas utility/i);
  });

  it("covers an out-of-area address → soft decline via take_message, never books", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // the service area is rendered in BUSINESS FACTS; the rule tells the agent to soft-decline a
    // clearly out-of-area address and use take_message instead of booking.
    expect(p).toMatch(/out of service area|outside that area|outside the area you cover/i);
    expect(p).toMatch(/take_message/);
    expect(p).toMatch(/do NOT book an out-of-area job|do not book an out-of-area/i);
    // the service area (cities + radius) is present in the prompt for the agent to reason against
    expect(p).toMatch(/Pleasanton, Dublin/);
    expect(p).toMatch(/25 miles|within 25/);
  });

  it("emergency is ALWAYS ON: the generic safety-net rule fires even with no emergency words configured", () => {
    // Build a playbook where NO service has emergencyTriggers — the empty-config case that used to
    // mean zero emergency routing. The always-on rule must still be present.
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/Emergency \(always on\)/);
    expect(p).toMatch(/even if it matches no service's emergency words/i);
    // The safety-net examples: active damage/safety signals, trade-agnostic.
    expect(p).toMatch(/actively flowing or flooding/i);
    expect(p).toMatch(/no heat in freezing weather/i);
    expect(p).toMatch(/electrical burning smell/i);
    expect(p).toMatch(/can't be secured/i);
    // Still books soonest + notes EMERGENCY (the behavior the old rule carried).
    expect(p).toMatch(/book the soonest slot and note EMERGENCY/i);
    // The old hardcoded plumbing emergency phrase stays GONE.
    expect(p).not.toMatch(/flooding, sewage/i);
  });

  it("per-service EMERGENCY words are EXTENSIONS of the always-on rule, not the sole trigger", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/EMERGENCY words .*EXTEND/i);
    expect(p).toMatch(/additions, never the only emergencies/i);
  });

  it("gas stays 911-only: excluded from the bookable emergency path AND the shutoff coaching", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    // The emergency rule explicitly defers gas to the 911 rule (a gas leak is never a booking).
    expect(p).toMatch(/gas leak is 911 — leave the building, never a booking/i);
    // The shutoff coaching names water/power only — never coach a caller to touch a gas valve
    // (the gas rule says LEAVE the building; coaching a gas shutoff would contradict it).
    expect(p).toMatch(/shut off water or power at the source/i);
    expect(p).not.toMatch(/shut off the water\/gas\/power/i);
  });

  it("covers reschedule/cancel/where-is-my-tech/billing → take_message, never discuss amounts", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/reschedule|cancel|where.*tech/i);
    expect(p).toMatch(/take_message/);
    expect(p).toMatch(/never discuss billing|do not discuss billing/i);
  });

  it("covers vendor/spam/wrong number → end politely", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/vendor|spam|wrong number/i);
  });

  it("covers tenant in a rental → landlord authorization for non-emergency work", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/tenant/i);
    expect(p).toMatch(/landlord/i);
  });

  it("covers quote-only → request_quote + office CALLBACK promise (texting off until A2P live)", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/request_quote/);
    expect(p).toMatch(/office will call them back with a written quote/i);
  });
});

describe("buildSystemPrompt — iron guardrails", () => {
  it("forbids unlisted dollar amounts, caps reply length, confirms phone/address, no exact arrival time", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/never (say|state|quote) a dollar amount/i);
    expect(p).toMatch(/25 words|under.*25/i);
    expect(p).toMatch(/digit-by-digit/i);
    expect(p).toMatch(/read.*address back/i);
    // Commit to a start time but not a to-the-minute arrival — must NOT forbid offering a start time.
    expect(p).toMatch(/to-the-minute arrival/i);
    expect(p).toMatch(/arrival window/i);
  });
});

describe("buildSystemPrompt — caller context section", () => {
  it("greets by name and references open work ONLY when the caller is known", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: knownCaller });
    expect(p).toContain("Dana Ruiz");
    expect(p).toContain("job #142 scheduled Jul 16 (drain clear)");
  });

  it("has NO caller-context section for an unknown caller", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).not.toMatch(/Dana Ruiz/);
    expect(p).not.toMatch(/known caller|the caller is/i);
  });
});

describe("buildSystemPrompt — PRICE GUARDRAIL (the heart)", () => {
  it("contains NO dollar amount other than the configured serviceFee and flat prices", () => {
    const facts = baseFacts();
    const p = buildSystemPrompt({ facts, caller: knownCaller });
    const allowed = allowedTokens(facts);
    for (const token of dollarTokens(p)) {
      expect(allowed.has(token)).toBe(true);
    }
    // sanity: the prompt DOES contain the allowed ones
    expect(dollarTokens(p).length).toBeGreaterThan(0);
  });

  it("emits no stray dollar amount even when there are no flat services", () => {
    const facts = baseFacts({
      services: [
        { name: "Faucet repair", lane: "repair", triggers: "leak" },
        { name: "Water heater replacement", lane: "estimate", triggers: "no hot water" },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(dollarTokens(p)).toEqual([`$${facts.serviceFee}`]);
  });
});

// Owner free-text fields are interpolated verbatim — an owner who types a price into any of
// them must NOT be able to smuggle an unsanctioned spoken price into the prompt. Each fixture
// injects a stray "$" into exactly one free-text field and asserts the rendered prompt's dollar
// tokens equal EXACTLY the allowed set (serviceFee + flat prices), with the marker present.
describe("buildSystemPrompt — PRICE GUARDRAIL (owner free-text injection)", () => {
  it("redacts a stray price hidden in a service's triggers ($50 off)", () => {
    const facts = baseFacts({
      services: [
        { name: "Drain cleaning", lane: "flat", price: 149, triggers: "clog, $50 off promo" },
        { name: "Faucet repair", lane: "repair", triggers: "leaky faucet" },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(new Set(dollarTokens(p))).toEqual(allowedTokens(facts));
    expect(p).not.toContain("$50");
    expect(p).toContain(PRICE_REDACTION_MARKER);
  });

  it("redacts a stray price hidden in notServices (septic ($500+ jobs))", () => {
    const facts = baseFacts({ notServices: "septic ($500+ jobs), well pumps" });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(new Set(dollarTokens(p))).toEqual(allowedTokens(facts));
    expect(p).not.toContain("$500");
    expect(p).toContain(PRICE_REDACTION_MARKER);
  });

  it("redacts a stray price hidden in a known caller's openWork ($500 repipe)", () => {
    const facts = baseFacts();
    const caller: CallerContext = {
      known: true,
      name: "Dana Ruiz",
      openWork: "job #142 scheduled Jul 16 ($500 repipe)",
    };
    const p = buildSystemPrompt({ facts, caller });
    expect(new Set(dollarTokens(p))).toEqual(allowedTokens(facts));
    expect(p).not.toContain("$500");
    expect(p).toContain(PRICE_REDACTION_MARKER);
    // the non-price parts of the open-work line still render
    expect(p).toContain("job #142 scheduled Jul 16");
  });
});

describe("redactPriceTokens", () => {
  it("replaces a leading dollar token with the marker, keeping the rest", () => {
    expect(redactPriceTokens("$50 off")).toBe(`${PRICE_REDACTION_MARKER} off`);
  });

  it("replaces a comma/decimal dollar amount with the marker", () => {
    expect(redactPriceTokens("$1,250.00")).toBe(PRICE_REDACTION_MARKER);
  });

  it("handles whitespace between the sign and digits ($ 500)", () => {
    expect(redactPriceTokens("septic ($ 500+ jobs)")).toBe(
      `septic (${PRICE_REDACTION_MARKER}+ jobs)`,
    );
  });

  it("leaves text with no dollar amounts unchanged", () => {
    expect(redactPriceTokens("no dollars here")).toBe("no dollars here");
  });

  it("strips a lone dollar sign with no digits", () => {
    expect(redactPriceTokens("cash $ only")).toBe("cash  only");
    expect(redactPriceTokens("$")).toBe("");
  });

  it("leaves legit non-price numbers untouched (24/7, 2 hours)", () => {
    expect(redactPriceTokens("24/7 emergency, about 2 hours")).toBe(
      "24/7 emergency, about 2 hours",
    );
  });

  it("redacts every dollar token when several appear", () => {
    expect(redactPriceTokens("$50 now or $1,000 later")).toBe(
      `${PRICE_REDACTION_MARKER} now or ${PRICE_REDACTION_MARKER} later`,
    );
  });
});

describe("buildSystemPrompt — per-service emergencyTriggers", () => {
  it("renders emergencyTriggers on the service line when set", () => {
    const facts = baseFacts({
      services: [
        {
          name: "Drain cleaning",
          lane: "flat",
          price: 149,
          triggers: "clogged drain",
          emergencyTriggers: "backed up sewage, flooding",
        },
        { name: "Faucet repair", lane: "repair", triggers: "leaky faucet" },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const drainLine = p.split("\n").find((l) => l.includes("Drain cleaning")) ?? "";
    expect(drainLine).toContain("emergency:");
    expect(drainLine).toContain("backed up sewage, flooding");
  });

  it("does NOT render an 'emergency:' suffix on a service without emergencyTriggers", () => {
    const facts = baseFacts({
      services: [{ name: "Faucet repair", lane: "repair", triggers: "leaky faucet" }],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const faucetLine = p.split("\n").find((l) => l.includes("Faucet repair")) ?? "";
    expect(faucetLine).not.toContain("emergency:");
  });

  it("redacts a stray price in emergencyTriggers ($99 surcharge)", () => {
    const facts = baseFacts({
      services: [
        {
          name: "Burst pipe",
          lane: "repair",
          triggers: "pipe burst",
          emergencyTriggers: "no water, burst pipe, $99 after-hours",
        },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(p).not.toContain("$99");
    expect(p).toContain(PRICE_REDACTION_MARKER);
    // Non-price trigger words still render
    expect(p).toContain("no water");
  });
});

describe("buildSystemPrompt — deferKeywords in BUSINESS FACTS", () => {
  it("renders deferKeywords line in BUSINESS FACTS when set", () => {
    const facts = baseFacts({ deferKeywords: "HOA, property manager, commercial account" });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const factsSection = p.split("## ").find((s) => s.startsWith("BUSINESS FACTS")) ?? "";
    expect(factsSection).toContain("HOA, property manager, commercial account");
    expect(factsSection).toMatch(/Hand off to a person/i);
  });

  it("omits the deferKeywords line entirely when deferKeywords is undefined", () => {
    const facts = baseFacts();
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const factsSection = p.split("## ").find((s) => s.startsWith("BUSINESS FACTS")) ?? "";
    // The line should be absent when deferKeywords is not set
    expect(factsSection).not.toMatch(/Hand off to a person.*on top of the standard cases/i);
  });

  it("omits the deferKeywords line when deferKeywords is an empty string", () => {
    const facts = baseFacts({ deferKeywords: "" });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const factsSection = p.split("## ").find((s) => s.startsWith("BUSINESS FACTS")) ?? "";
    expect(factsSection).not.toMatch(/Hand off to a person.*on top of the standard cases/i);
  });

  it("redacts a stray price in deferKeywords ($50 discount calls)", () => {
    const facts = baseFacts({ deferKeywords: "fleet account, $50 discount calls" });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const factsSection = p.split("## ").find((s) => s.startsWith("BUSINESS FACTS")) ?? "";
    expect(factsSection).not.toContain("$50");
    expect(factsSection).toContain(PRICE_REDACTION_MARKER);
    expect(factsSection).toContain("fleet account");
  });
});

describe("buildSystemPrompt — defer/hand-off CASE_RULE", () => {
  it("names escalate_callback and lists insurance/claim/warranty/'a person'", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const casesSection = p.split("## ").find((s) => s.startsWith("CASE RULES")) ?? "";
    expect(casesSection).toContain(TOOL_NAMES.escalateCallback);
    expect(casesSection).toMatch(/insurance/i);
    expect(casesSection).toMatch(/claim/i);
    expect(casesSection).toMatch(/warrant/i);
    expect(casesSection).toMatch(/speak to a person|a person/i);
  });
});

describe("buildSystemPrompt — no-same-day-emergency CASE_RULE", () => {
  it("names escalate_callback and references check_availability for no-slot emergency", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const casesSection = p.split("## ").find((s) => s.startsWith("CASE RULES")) ?? "";
    expect(casesSection).toContain(TOOL_NAMES.escalateCallback);
    expect(casesSection).toContain(TOOL_NAMES.checkAvailability);
    expect(casesSection).toMatch(/no slot|no same-day/i);
  });
});

describe("buildSystemPrompt — escalate_callback in TOOLS & FLOW", () => {
  it("names escalate_callback by exact name in the TOOLS & FLOW section", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const toolsSection = p.split("## ").find((s) => s.startsWith("TOOLS & FLOW")) ?? "";
    expect(toolsSection).toContain(TOOL_NAMES.escalateCallback);
    expect(toolsSection).toContain("escalate_callback");
  });
});

describe("buildSystemPrompt — PRICE GUARDRAIL (emergencyTriggers + deferKeywords)", () => {
  it("redacts a price in emergencyTriggers and keeps no $ in the rendered prompt beyond allowed", () => {
    const facts = baseFacts({
      services: [
        {
          name: "Pipe repair",
          lane: "repair",
          triggers: "burst pipe",
          emergencyTriggers: "flooding, $99 emergency fee",
        },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(p).not.toContain("$99");
    expect(p).toContain(PRICE_REDACTION_MARKER);
    // Only the serviceFee ($89) is allowed
    const allowed = allowedTokens(facts);
    for (const token of dollarTokens(p)) {
      expect(allowed.has(token)).toBe(true);
    }
  });

  it("redacts a price in deferKeywords and keeps no $ in the rendered prompt beyond allowed", () => {
    const facts = baseFacts({ deferKeywords: "HOA billing, $50 senior discount" });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    expect(p).not.toContain("$50");
    expect(p).toContain(PRICE_REDACTION_MARKER);
    // Only the serviceFee ($89) + flat price ($149) are allowed
    const allowed = allowedTokens(facts);
    for (const token of dollarTokens(p)) {
      expect(allowed.has(token)).toBe(true);
    }
  });
});

describe("buildSystemPrompt — ballpark (estimate-lane owner price range)", () => {
  it("renders a ballpark VERBATIM on the service line — $150 and $300 both present, NOT redacted", () => {
    const facts = baseFacts({
      services: [
        {
          name: "Water heater replacement",
          lane: "estimate",
          triggers: "no hot water",
          ballpark: "$150–$300",
        },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const line = p.split("\n").find((l) => l.includes("Water heater replacement")) ?? "";
    expect(line).toContain("$150");
    expect(line).toContain("$300");
    expect(line).not.toContain(PRICE_REDACTION_MARKER);
    expect(line).toContain("ballpark:");
  });

  it("CRITICAL: redacts a $ in triggers but keeps the $ in ballpark on the SAME service", () => {
    // This is the load-bearing redaction-inversion test: triggers go through redactPriceTokens,
    // ballpark does NOT. Both fields exist on the same service.
    const facts = baseFacts({
      services: [
        {
          name: "Water heater replacement",
          lane: "estimate",
          triggers: "leaking, $50 off",
          ballpark: "$200",
        },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const line = p.split("\n").find((l) => l.includes("Water heater replacement")) ?? "";
    // ballpark kept
    expect(line).toContain("$200");
    // trigger price redacted
    expect(line).not.toContain("$50");
    expect(line).toContain(PRICE_REDACTION_MARKER);
  });

  it("does NOT render a 'ballpark:' label on a service without a ballpark field", () => {
    const facts = baseFacts({
      services: [{ name: "Faucet repair", lane: "repair", triggers: "leaky faucet" }],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const line = p.split("\n").find((l) => l.includes("Faucet repair")) ?? "";
    expect(line).not.toContain("ballpark:");
  });

  it("treats an empty ballpark as absent — no 'ballpark:' rendered", () => {
    const facts = baseFacts({
      services: [
        { name: "Water heater replacement", lane: "estimate", triggers: "no hot water", ballpark: "" },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const line = p.split("\n").find((l) => l.includes("Water heater replacement")) ?? "";
    expect(line).not.toContain("ballpark:");
  });

  it("treats a whitespace-only ballpark as absent — no 'ballpark:' rendered", () => {
    const facts = baseFacts({
      services: [
        { name: "Water heater replacement", lane: "estimate", triggers: "no hot water", ballpark: "   " },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const line = p.split("\n").find((l) => l.includes("Water heater replacement")) ?? "";
    expect(line).not.toContain("ballpark:");
  });

  it("estimate-lane guidance mentions stating ballpark ONCE + 'exact price after we see it' disclaimer", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const servicesSection = p.split("## ").find((s) => s.startsWith("SERVICES")) ?? "";
    expect(servicesSection).toMatch(/ballpark range/i);
    expect(servicesSection).toMatch(/state it ONCE|may state it ONCE/i);
    expect(servicesSection).toMatch(/exact price.*after we see it|the exact price is after/i);
  });

  it("estimate-lane guidance still includes 'never say a job price' for services without ballpark", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    const servicesSection = p.split("## ").find((s) => s.startsWith("SERVICES")) ?? "";
    expect(servicesSection).toMatch(/never say a job price/i);
  });

  it("PRICE GUARDRAIL sweep: ballpark $ tokens are allowed — no sweep violation", () => {
    const facts = baseFacts({
      services: [
        { name: "Drain cleaning", lane: "flat", price: 149, triggers: "clogged drain" },
        {
          name: "Water heater replacement",
          lane: "estimate",
          triggers: "no hot water",
          ballpark: "$150–$300",
        },
      ],
    });
    const p = buildSystemPrompt({ facts, caller: unknownCaller });
    const allowed = allowedTokens(facts);
    for (const token of dollarTokens(p)) {
      expect(allowed.has(token)).toBe(true);
    }
    // ballpark tokens appear in the prompt
    expect(p).toContain("$150");
    expect(p).toContain("$300");
  });
});
