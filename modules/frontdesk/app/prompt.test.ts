import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildFirstMessage } from "./prompt";
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

describe("buildFirstMessage", () => {
  it("is the exact compliance greeting with the brand interpolated", () => {
    expect(buildFirstMessage("Bayline Plumbing")).toBe(
      "Thanks for calling Bayline Plumbing. You're speaking with Bayline Plumbing's AI assistant — this call is recorded. How can I help?",
    );
  });
});

describe("buildSystemPrompt — identity & compliance", () => {
  it("states it is the brand's AI assistant, recorded, and truthful about being an AI", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/AI assistant/i);
    expect(p).toMatch(/recorded/i);
    expect(p).toMatch(/Bayline Plumbing/);
    // truthful-if-asked-human rule
    expect(p).toMatch(/if asked.*human|whether you are human|you are an AI/i);
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

  it("includes the repair fee-credit framing and two-slot close", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/exact price on-site|diagnoses/i);
    expect(p).toMatch(/two.*slot|today.*tomorrow|two time/i);
  });

  it("frames the estimate lane as a free estimate visit", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/free estimate/i);
  });
});

describe("buildSystemPrompt — case rules", () => {
  it("covers gas leak → 911 + gas utility, no booking", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/gas (leak|smell)/i);
    expect(p).toMatch(/911/);
    expect(p).toMatch(/gas utility/i);
  });

  it("covers emergency (flooding/sewage/no water) → book soonest + note EMERGENCY", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/flooding|sewage|no water|burst/i);
    expect(p).toMatch(/EMERGENCY/);
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

  it("covers quote-only → request_quote + office text promise", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/request_quote/);
    expect(p).toMatch(/office will text|text (you )?a (written )?quote/i);
  });
});

describe("buildSystemPrompt — iron guardrails", () => {
  it("forbids unlisted dollar amounts, caps reply length, confirms phone/address, no exact arrival time", () => {
    const p = buildSystemPrompt({ facts: baseFacts(), caller: unknownCaller });
    expect(p).toMatch(/never (say|state|quote) a dollar amount/i);
    expect(p).toMatch(/25 words|under.*25/i);
    expect(p).toMatch(/digit-by-digit/i);
    expect(p).toMatch(/read.*address back/i);
    expect(p).toMatch(/never promise an exact arrival|only the (arrival )?window/i);
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
    const allowed = new Set<string>([
      `$${facts.serviceFee}`,
      ...facts.services
        .filter((s) => s.lane === "flat" && s.price !== undefined)
        .map((s) => `$${s.price}`),
    ]);
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
