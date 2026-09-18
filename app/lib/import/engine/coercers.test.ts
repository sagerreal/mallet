/**
 * Coercer registry tests.
 *
 * `enum` has no descriptor using it yet — jobs will, for status columns where a foreign export
 * says "Scheduled" / "open" / "In Progress". Tested now so the first entity to need it inherits a
 * verified coercer rather than discovering its behaviour in production.
 */

import { describe, it, expect } from "vitest";
import { COERCERS } from "./coercers";
import type { ImportFieldSpec } from "./descriptor";

const spec = (over: Partial<ImportFieldSpec> = {}): ImportFieldSpec => ({
  key: "f",
  label: "Field",
  synonyms: [],
  coerce: "text",
  ...over,
});

describe("phone", () => {
  it.each([
    ["(925) 555-0100", true],
    ["925-555-0142", true],
    ["19255550142", true], // 11 digits with a leading 1
    ["555", false],
    ["not a phone", false],
  ])("%s → ok=%s", (raw, expected) => {
    expect(COERCERS.phone(raw, spec()).ok).toBe(expected);
  });
});

describe("email", () => {
  it("accepts a well-formed address and rejects the rest", () => {
    expect(COERCERS.email("ann@example.com", spec()).ok).toBe(true);
    expect(COERCERS.email("not-an-email", spec()).ok).toBe(false);
    expect(COERCERS.email("a@b", spec()).ok).toBe(false); // no TLD
  });
});

describe("money", () => {
  it("parses currency formatting to integer cents", () => {
    expect(COERCERS.money("$1,250.00", spec())).toEqual({ ok: true, value: 125_000 });
    expect(COERCERS.money("620", spec())).toEqual({ ok: true, value: 62_000 });
  });

  it("rejects text and negatives rather than guessing", () => {
    expect(COERCERS.money("call for price", spec()).ok).toBe(false);
    expect(COERCERS.money("-5", spec()).ok).toBe(false);
  });
});

describe("integer", () => {
  it("accepts whole numbers with thousands separators", () => {
    expect(COERCERS.integer("3", spec())).toEqual({ ok: true, value: 3 });
    expect(COERCERS.integer("1,200", spec())).toEqual({ ok: true, value: 1200 });
  });

  it("rejects decimals and words", () => {
    expect(COERCERS.integer("3.5", spec()).ok).toBe(false);
    expect(COERCERS.integer("about a week", spec()).ok).toBe(false);
  });
});

describe("boolean", () => {
  it("never fails — an unrecognised value simply is not true", () => {
    expect(COERCERS.boolean("yes", spec())).toEqual({ ok: true, value: true });
    expect(COERCERS.boolean("TRUE", spec())).toEqual({ ok: true, value: true });
    expect(COERCERS.boolean("no", spec())).toEqual({ ok: true, value: false });
    expect(COERCERS.boolean("banana", spec())).toEqual({ ok: true, value: false });
  });
});

describe("date", () => {
  it("accepts ISO unchanged", () => {
    expect(COERCERS.date("2026-08-12", spec())).toEqual({ ok: true, value: "2026-08-12" });
    expect(COERCERS.date("2026-8-2", spec())).toEqual({ ok: true, value: "2026-08-02" });
  });

  it("reads ambiguous slash dates month-first (US), the beachhead market", () => {
    expect(COERCERS.date("3/4/26", spec())).toEqual({ ok: true, value: "2026-03-04" });
    expect(COERCERS.date("12/25/2026", spec())).toEqual({ ok: true, value: "2026-12-25" });
  });

  it("accepts dot and dash separators", () => {
    expect(COERCERS.date("3.4.2026", spec())).toEqual({ ok: true, value: "2026-03-04" });
    expect(COERCERS.date("3-4-2026", spec())).toEqual({ ok: true, value: "2026-03-04" });
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    // Date.UTC would silently turn this into 3 March; the round-trip check catches it.
    expect(COERCERS.date("2/31/2026", spec()).ok).toBe(false);
    expect(COERCERS.date("13/1/2026", spec()).ok).toBe(false);
  });

  it("rejects free text", () => {
    expect(COERCERS.date("next Tuesday", spec()).ok).toBe(false);
    expect(COERCERS.date("", spec()).ok).toBe(false);
  });
});

describe("time", () => {
  it("accepts 24-hour input", () => {
    expect(COERCERS.time("14:30", spec())).toEqual({ ok: true, value: "14:30" });
    expect(COERCERS.time("8:05", spec())).toEqual({ ok: true, value: "08:05" });
  });

  it("converts 12-hour input", () => {
    expect(COERCERS.time("2:30 PM", spec())).toEqual({ ok: true, value: "14:30" });
    expect(COERCERS.time("2pm", spec())).toEqual({ ok: true, value: "14:00" });
    expect(COERCERS.time("12:15 am", spec())).toEqual({ ok: true, value: "00:15" });
    expect(COERCERS.time("12:15 pm", spec())).toEqual({ ok: true, value: "12:15" });
  });

  it("rejects out-of-range and unreadable values", () => {
    expect(COERCERS.time("25:00", spec()).ok).toBe(false);
    expect(COERCERS.time("10:75", spec()).ok).toBe(false);
    expect(COERCERS.time("morning", spec()).ok).toBe(false);
  });
});

describe("enum", () => {
  const status = spec({
    coerce: "enum",
    enumValues: {
      scheduled: "scheduled",
      open: "scheduled",
      "in progress": "in_progress",
      complete: "complete",
    },
  });

  it("maps known spellings to the canonical value, case-insensitively", () => {
    expect(COERCERS.enum("Scheduled", status)).toEqual({ ok: true, value: "scheduled" });
    expect(COERCERS.enum("open", status)).toEqual({ ok: true, value: "scheduled" });
    expect(COERCERS.enum("In Progress", status)).toEqual({ ok: true, value: "in_progress" });
  });

  it("rejects an unknown value, naming it so the warning is actionable", () => {
    const result = COERCERS.enum("Pending", status);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Pending");
  });

  it("rejects everything when the descriptor declared no values", () => {
    expect(COERCERS.enum("anything", spec({ coerce: "enum" })).ok).toBe(false);
  });
});
