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
});

describe("bookingCfgDTO", () => {
  const baseService = {
    name: "Drain cleaning",
    lane: "repair" as const,
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
