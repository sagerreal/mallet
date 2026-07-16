// Unit tests for the pure skill-gate logic. Import DIRECTLY from the implementation file —
// not a barrel — so the test run stays hermetic (no DB env vars, no infra imports).
import { describe, it, expect } from "vitest";
import {
  normCert,
  meetsRequirement,
  missingCerts,
  resolveServiceRequirement,
} from "./skill-gate";

// ── normCert ──────────────────────────────────────────────────────────────────

describe("normCert", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normCert("  Gas  ")).toBe("gas");
  });

  it("casefolds to lowercase", () => {
    expect(normCert("BOILER")).toBe("boiler");
  });

  it("handles already-normalized input unchanged", () => {
    expect(normCert("gas")).toBe("gas");
  });
});

// ── meetsRequirement ──────────────────────────────────────────────────────────

describe("meetsRequirement", () => {
  it("subset pass: tech holds Gas+Boiler, only Gas required → true", () => {
    expect(meetsRequirement(["Gas", "Boiler"], ["Gas"])).toBe(true);
  });

  it("superset pass: tech holds exact certs required → true", () => {
    expect(meetsRequirement(["Gas", "Boiler"], ["Gas", "Boiler"])).toBe(true);
  });

  it("one missing cert → false", () => {
    expect(meetsRequirement(["Gas"], ["Gas", "Boiler"])).toBe(false);
  });

  it("required null → true (no requirement)", () => {
    expect(meetsRequirement(["Gas"], null)).toBe(true);
  });

  it("required undefined → true (no requirement)", () => {
    expect(meetsRequirement(["Gas"], undefined)).toBe(true);
  });

  it("required empty array → true (no requirement)", () => {
    expect(meetsRequirement(["Gas"], [])).toBe(true);
  });

  it("case+trim both sides: '  GAS ' required vs 'gas' held → true", () => {
    expect(meetsRequirement(["gas"], ["  GAS "])).toBe(true);
  });

  it("tech with no certs, non-empty required → false", () => {
    expect(meetsRequirement([], ["Gas"])).toBe(false);
  });
});

// ── missingCerts ──────────────────────────────────────────────────────────────

describe("missingCerts", () => {
  it("unqualified: returns the missing entries in REQUIRED-side display casing", () => {
    // Tech holds "gas" (lowercase); required has "Gas" (title-cased display).
    // Missing should come back as "Gas", not "gas".
    expect(missingCerts(["gas"], ["Gas", "Boiler"])).toEqual(["Boiler"]);
  });

  it("unqualified: all required certs missing → returns all in display casing", () => {
    expect(missingCerts([], ["Gas", "Boiler"])).toEqual(["Gas", "Boiler"]);
  });

  it("qualified: all required certs held → empty array", () => {
    expect(missingCerts(["Gas", "Boiler"], ["Gas", "Boiler"])).toEqual([]);
  });

  it("no requirement (null) → empty array", () => {
    expect(missingCerts(["Gas"], null)).toEqual([]);
  });

  it("no requirement (undefined) → empty array", () => {
    expect(missingCerts(["Gas"], undefined)).toEqual([]);
  });

  it("no requirement (empty array) → empty array", () => {
    expect(missingCerts(["Gas"], [])).toEqual([]);
  });
});

// ── resolveServiceRequirement ─────────────────────────────────────────────────

describe("resolveServiceRequirement", () => {
  const services = [
    { name: "Water Heater", requiredCerts: ["Gas", "Boiler"] },
    { name: "Drain Cleaning", requiredCerts: [] },
    { name: "Leak Detection" }, // requiredCerts undefined
    { name: "Gas Line", requiredCerts: ["Gas"] },
  ] as const;

  it("exact-normalized match ('water heater' text vs 'Water Heater' service) → its certs", () => {
    expect(resolveServiceRequirement(services, "water heater")).toEqual(["Gas", "Boiler"]);
  });

  it("match is case+trim insensitive on the text side", () => {
    expect(resolveServiceRequirement(services, "  WATER HEATER  ")).toEqual(["Gas", "Boiler"]);
  });

  it("text with no matching service → null", () => {
    expect(resolveServiceRequirement(services, "Roof Repair")).toBeNull();
  });

  it("matched entry with requiredCerts undefined → null", () => {
    expect(resolveServiceRequirement(services, "Leak Detection")).toBeNull();
  });

  it("matched entry with requiredCerts [] → null (empty means no requirement)", () => {
    expect(resolveServiceRequirement(services, "Drain Cleaning")).toBeNull();
  });

  it("text null → null", () => {
    expect(resolveServiceRequirement(services, null)).toBeNull();
  });

  it("text undefined → null", () => {
    expect(resolveServiceRequirement(services, undefined)).toBeNull();
  });

  it("text blank ('  ') → null", () => {
    expect(resolveServiceRequirement(services, "  ")).toBeNull();
  });

  it("returned array is a FRESH copy (not the same reference as the service's array)", () => {
    const result = resolveServiceRequirement(services, "Gas Line");
    expect(result).toEqual(["Gas"]);
    // The services array above is `as const` so any mutation would be caught by TS,
    // but we confirm the reference differs (runtime immutability guarantee).
    expect(result).not.toBe((services[3] as { requiredCerts: readonly string[] }).requiredCerts);
  });
});
