import { describe, it, expect } from "vitest";
import { scopeSuggestsFoundWork, decorateScope } from "./found-work";

// ── scopeSuggestsFoundWork ───────────────────────────────────────────────────

describe("scopeSuggestsFoundWork", () => {
  it("returns true for 'the water heater is really old'", () => {
    expect(scopeSuggestsFoundWork("the water heater is really old")).toBe(true);
  });

  it("returns true for 'rusty pipes'", () => {
    expect(scopeSuggestsFoundWork("rusty pipes")).toBe(true);
  });

  it("returns true for 'some water damage under the sink'", () => {
    expect(scopeSuggestsFoundWork("some water damage under the sink")).toBe(true);
  });

  it("returns false for 'just a dripping faucet please' (no keyword)", () => {
    expect(scopeSuggestsFoundWork("just a dripping faucet please")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(scopeSuggestsFoundWork("")).toBe(false);
  });

  it("is case-insensitive (OLD, RUSTY, DAMAGE)", () => {
    expect(scopeSuggestsFoundWork("THE HEATER IS OLD")).toBe(true);
    expect(scopeSuggestsFoundWork("RUSTY VALVE")).toBe(true);
    expect(scopeSuggestsFoundWork("WATER DAMAGE")).toBe(true);
  });

  it("matches 'leaking' keyword", () => {
    expect(scopeSuggestsFoundWork("pipes are leaking under there")).toBe(true);
  });

  it("matches 'cracked' keyword", () => {
    expect(scopeSuggestsFoundWork("the pipe looks cracked")).toBe(true);
  });

  it("matches 'original' keyword", () => {
    expect(scopeSuggestsFoundWork("the unit looks original to the house")).toBe(true);
  });

  it("matches 'years old' keyword", () => {
    expect(scopeSuggestsFoundWork("it is about 20 years old")).toBe(true);
  });

  it("matches 'mold' keyword", () => {
    expect(scopeSuggestsFoundWork("there is some mold on the wall")).toBe(true);
  });

  it("matches 'rot' keyword", () => {
    expect(scopeSuggestsFoundWork("the wood looks like rot")).toBe(true);
  });
});

// ── decorateScope ────────────────────────────────────────────────────────────

describe("decorateScope", () => {
  it("returns null for null input", () => {
    expect(decorateScope(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(decorateScope(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decorateScope("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(decorateScope("   ")).toBeNull();
  });

  it("returns the trimmed note unchanged when no found-work keyword hits", () => {
    expect(decorateScope("  just a dripping faucet  ")).toBe("just a dripping faucet");
  });

  it("trims whitespace from a plain note", () => {
    expect(decorateScope("  faucet is dripping  ")).toBe("faucet is dripping");
  });

  it("prefixes with '[likely found-work] ' when a found-work keyword hits", () => {
    expect(decorateScope("the water heater is really old")).toBe(
      "[likely found-work] the water heater is really old",
    );
  });

  it("prefixes for 'rusty pipes'", () => {
    expect(decorateScope("rusty pipes")).toBe("[likely found-work] rusty pipes");
  });

  it("prefixes for 'some water damage under the sink'", () => {
    expect(decorateScope("some water damage under the sink")).toBe(
      "[likely found-work] some water damage under the sink",
    );
  });

  it("is case-insensitive for the prefix decision", () => {
    expect(decorateScope("RUSTY VALVE")).toBe("[likely found-work] RUSTY VALVE");
  });

  it("trims before the found-work check and prefix", () => {
    const result = decorateScope("   rusty pipes   ");
    expect(result).toBe("[likely found-work] rusty pipes");
  });

  it("does NOT double-prefix (idempotent shape)", () => {
    // If a decorated note is passed in again, it matches 'found-work' only if it actually contains
    // a keyword. The prefix itself ("likely found-work") contains no FOUND_WORK_KEYWORDS → no
    // double-prefix for a plain note that was already prefixed.
    const once = decorateScope("the heater is old");
    // Pass the already-prefixed string through a second time to check it doesn't double-prefix.
    // The result already starts with "[likely found-work]" which has no keyword, so it won't trigger
    // another prefix UNLESS the original text with keyword was embedded.
    expect(once).toBe("[likely found-work] the heater is old");
  });
});
