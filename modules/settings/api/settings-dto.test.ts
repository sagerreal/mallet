/**
 * modules/settings/api/settings-dto.test.ts
 * Unit tests for the bookingServiceDTO and bookingCfgDTO sub-schemas.
 * Asserts that the new optional fields (emergencyTriggers, deferKeywords) parse
 * correctly both when present and when absent.
 */

import { describe, it, expect } from "vitest";
import { bookingServiceDTO, bookingCfgDTO } from "./settings-dto";

describe("bookingServiceDTO", () => {
  const baseService = {
    name: "Drain cleaning",
    lane: "flat" as const,
    price: 99,
    triggers: "clogged, slow drain",
  };

  it("parses a service without emergencyTriggers (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBeUndefined();
    }
  });

  it("parses a service WITH emergencyTriggers", () => {
    const input = { ...baseService, emergencyTriggers: "burst pipe, flooding" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBe("burst pipe, flooding");
    }
  });

  it("parses a service with an empty string emergencyTriggers", () => {
    const input = { ...baseService, emergencyTriggers: "" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyTriggers).toBe("");
    }
  });

  it("parses a service WITHOUT ballpark (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ballpark).toBeUndefined();
    }
  });

  it("parses a service WITH ballpark", () => {
    const input = { ...baseService, ballpark: "$150–$300" };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ballpark).toBe("$150–$300");
    }
  });

  // T3: requiredCerts

  it("parses a service WITHOUT requiredCerts (optional field absent)", () => {
    const result = bookingServiceDTO.safeParse(baseService);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toBeUndefined();
    }
  });

  it("parses a service WITH requiredCerts", () => {
    const input = { ...baseService, requiredCerts: ["Gas", "HVAC"] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toEqual(["Gas", "HVAC"]);
    }
  });

  it("rejects a requiredCerts entry exceeding 40 characters", () => {
    const input = { ...baseService, requiredCerts: ["A".repeat(41)] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a requiredCerts entry that is an empty string (min 1)", () => {
    const input = { ...baseService, requiredCerts: [""] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 requiredCerts entries (max 10)", () => {
    const input = { ...baseService, requiredCerts: Array.from({ length: 11 }, (_, i) => `Cert${i}`) };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("strips leading/trailing whitespace from requiredCerts entries via trim()", () => {
    const input = { ...baseService, requiredCerts: ["  Gas  "] };
    const result = bookingServiceDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiredCerts).toEqual(["Gas"]);
    }
  });
});

describe("bookingCfgDTO", () => {
  const baseService = {
    name: "Drain cleaning",
    lane: "estimate" as const,
    feeApplies: true,
    triggers: "leak",
  };

  const baseCfg = {
    services: [baseService],
    notServices: "septic",
    serviceFee: 89,
    feeCredited: true,
  };

  it("parses a cfg without deferKeywords (optional field absent)", () => {
    const result = bookingCfgDTO.safeParse(baseCfg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deferKeywords).toBeUndefined();
    }
  });

  it("parses a cfg WITH deferKeywords", () => {
    const input = { ...baseCfg, deferKeywords: "insurance, claim, warranty" };
    const result = bookingCfgDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deferKeywords).toBe("insurance, claim, warranty");
    }
  });

  it("parses a service with emergencyTriggers inside a cfg", () => {
    const input = {
      ...baseCfg,
      services: [{ ...baseService, emergencyTriggers: "no heat, burst pipe" }],
      deferKeywords: "adjuster",
    };
    const result = bookingCfgDTO.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services[0]?.emergencyTriggers).toBe("no heat, burst pipe");
      expect(result.data.deferKeywords).toBe("adjuster");
    }
  });
});
