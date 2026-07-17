import { describe, it, expect } from "vitest";
import { redactMoneyForTech } from "./money-redaction";

// Unit tests for the redactMoneyForTech helper — the server-side enforcement point
// for the org's techSeesPrice setting. These tests run without a DB connection and
// verify the pure transformation in isolation.

const usd = (cents: number) => ({ cents, currency: "USD" as const });

function makeDto(overrides: Partial<{
  rate: { cents: number; currency: "USD" } | null;
  cost: { cents: number; currency: "USD" } | null;
  total: { cents: number; currency: "USD" } | null;
}> = {}) {
  return {
    id: "job-1",
    total: overrides.total !== undefined ? overrides.total : usd(25000),
    lines: [
      {
        id: "line-1",
        description: "Panel swap",
        quantity: 1,
        rate: overrides.rate !== undefined ? overrides.rate : usd(25000),
        cost: overrides.cost !== undefined ? overrides.cost : usd(9000),
        position: 0,
      },
    ],
    addons: [
      {
        id: "addon-1",
        description: "Extra outlet",
        quantity: 1,
        rate: overrides.rate !== undefined ? overrides.rate : usd(12000),
        cost: overrides.cost !== undefined ? overrides.cost : usd(4000),
        isOptional: false,
        invoiceSkip: false,
        status: "proposed" as const,
        position: 0,
      },
    ],
  };
}

describe("redactMoneyForTech", () => {
  describe("when seesPrice = true (tech is allowed to see prices)", () => {
    it("preserves rate on lines", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, true);
      expect(result.lines[0]?.rate?.cents).toBe(25000);
    });

    it("always strips cost from lines (internal cost is never visible to techs)", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, true);
      expect(result.lines[0]?.cost).toBeNull();
    });

    it("preserves rate on addons", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, true);
      expect(result.addons[0]?.rate?.cents).toBe(12000);
    });

    it("always strips cost from addons", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, true);
      expect(result.addons[0]?.cost).toBeNull();
    });

    it("preserves total when seesPrice is true", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, true);
      expect(result.total?.cents).toBe(25000);
    });
  });

  describe("when seesPrice = false (org turned off tech price visibility)", () => {
    it("strips rate from lines", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, false);
      expect(result.lines[0]?.rate).toBeNull();
    });

    it("strips cost from lines", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, false);
      expect(result.lines[0]?.cost).toBeNull();
    });

    it("strips rate from addons", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, false);
      expect(result.addons[0]?.rate).toBeNull();
    });

    it("strips cost from addons", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, false);
      expect(result.addons[0]?.cost).toBeNull();
    });

    it("sets total to null — the money-leak fix", () => {
      const dto = makeDto();
      const result = redactMoneyForTech(dto, false);
      expect(result.total).toBeNull();
    });

    it("total null is returned even when the input total was null already (idempotent)", () => {
      const dto = makeDto({ total: null });
      const result = redactMoneyForTech(dto, false);
      expect(result.total).toBeNull();
    });
  });

  it("does not mutate the original DTO (immutability)", () => {
    const dto = makeDto();
    redactMoneyForTech(dto, false);
    // Original must be unchanged.
    expect(dto.total?.cents).toBe(25000);
    expect(dto.lines[0]?.rate?.cents).toBe(25000);
    expect(dto.addons[0]?.rate?.cents).toBe(12000);
  });

  it("handles empty lines and addons without throwing", () => {
    const dto = { id: "job-2", total: usd(0), lines: [], addons: [] };
    expect(() => redactMoneyForTech(dto, false)).not.toThrow();
    expect(redactMoneyForTech(dto, false).total).toBeNull();
  });
});
