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

  it("matches keyword inflections at a word boundary (older, leaking, corrosion, damaged)", () => {
    expect(scopeSuggestsFoundWork("the heater is older than the house")).toBe(true);
    expect(scopeSuggestsFoundWork("valve is corroded")).toBe(true);
    expect(scopeSuggestsFoundWork("the cabinet is damaged")).toBe(true);
  });

  it("does NOT fire on mid-word false positives ('old' in cold/sold/told, 'rust' in trust/crust)", () => {
    // The classic naive-substring traps: these everyday words must NOT be flagged found-work.
    expect(scopeSuggestsFoundWork("the water runs cold")).toBe(false);
    expect(scopeSuggestsFoundWork("they sold the house last year")).toBe(false);
    expect(scopeSuggestsFoundWork("I told the tenant to call")).toBe(false);
    expect(scopeSuggestsFoundWork("I don't trust the old owner's work")).toBe(true); // 'old' IS a word here
    expect(scopeSuggestsFoundWork("just need a new faucet, I trust you")).toBe(false); // 'trust' only → no match
    expect(scopeSuggestsFoundWork("cut the crust off")).toBe(false);
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

  it("is idempotent — re-decorating an already-marked note does NOT stack prefixes", () => {
    const once = decorateScope("the heater is old");
    expect(once).toBe("[likely found-work] the heater is old");
    // Feed the decorated result back through: the marker is stripped before the keyword check, so
    // the single prefix is preserved rather than doubled.
    const twice = decorateScope(once);
    expect(twice).toBe(once);
    expect(twice).not.toContain("[likely found-work] [likely found-work]");
  });
});
