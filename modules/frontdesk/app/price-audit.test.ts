import { describe, it, expect } from "vitest";
import { auditPrices } from "./price-audit";

// The deterministic post-call guardrail: every dollar amount the assistant SPOKE must be one an
// owner typed into the playbook (serviceFee + flat-lane prices). Anything else is a violation —
// the agent invented a number. auditPrices is pure: assistant lines + allowed dollars → the raw
// tokens that were not allowed. Formatting is normalized so "$1,250.00" == 1250 == "$1250".
describe("auditPrices", () => {
  it("returns empty when no line contains a dollar amount", () => {
    const lines = ["Sure, I can help with that.", "You're booked for tomorrow morning."];
    expect(auditPrices(lines, [89, 1250])).toEqual([]);
  });

  it("returns empty for an empty transcript", () => {
    expect(auditPrices([], [89])).toEqual([]);
  });

  it("passes a plain configured amount ($89 in the allowed set)", () => {
    expect(auditPrices(["The visit is $89, credited toward the repair."], [89, 1250])).toEqual([]);
  });

  it("treats comma/decimal formatting as equivalent to the plain number ($1,250.00 == 1250)", () => {
    expect(auditPrices(["Drain replacement is $1,250.00 flat."], [1250])).toEqual([]);
    expect(auditPrices(["Drain replacement is $1250 flat."], [1250])).toEqual([]);
    // The allowed value carrying cents still matches an integer-dollar spoken token.
    expect(auditPrices(["That is $89.00."], [89])).toEqual([]);
  });

  it("flags an amount that is not in the allowed set ($300 when only $89 is allowed)", () => {
    expect(auditPrices(["The repair will be about $300."], [89])).toEqual(["$300"]);
  });

  it("flags every unlisted amount and passes the listed ones in a mixed line", () => {
    const flagged = auditPrices(
      ["The visit is $89, and the full job runs around $300 to $450."],
      [89],
    );
    expect(flagged).toEqual(["$300", "$450"]);
  });

  it("scans every assistant line, not just the first", () => {
    const flagged = auditPrices(
      ["The visit is $89.", "Actually the part alone is $120."],
      [89],
    );
    expect(flagged).toEqual(["$120"]);
  });

  it("tolerates a space after the dollar sign ($ 300)", () => {
    expect(auditPrices(["It could be $ 300."], [89])).toEqual(["$ 300"]);
  });

  it("preserves the raw spoken token (with its original formatting) in the flagged output", () => {
    // The office needs to see exactly what the caller heard, so the original token text is returned.
    expect(auditPrices(["Around $1,999.99 total."], [89])).toEqual(["$1,999.99"]);
  });

  it("de-duplicates a repeated unlisted amount", () => {
    const flagged = auditPrices(["It's $300.", "Yes, $300 for that."], [89]);
    expect(flagged).toEqual(["$300"]);
  });

  it("an empty allowed set flags every spoken amount", () => {
    expect(auditPrices(["The fee is $89."], [])).toEqual(["$89"]);
  });
});
