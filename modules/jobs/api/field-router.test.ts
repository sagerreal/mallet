import { describe, it, expect } from "vitest";
import { redactMoneyForTech, FIELD_SURFACE_REDACTION } from "./money-redaction";

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

    it("strips rate from addons under the default (strict) reading", () => {
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

  // The one exemption, opt-in per caller. The technician's own screens set it because the CUSTOMER
  // is about to read the found-work price off the same tablet and sign for it; a $0 approval sheet
  // in front of a customer asking "how much?" is the failure mode. The AI copilot deliberately does
  // NOT set it — its prompt forbids the model from stating a price in a !seesPrice shop, so those
  // numbers must not enter its context.
  describe("FIELD_SURFACE_REDACTION (the found-work exemption)", () => {
    it("keeps addon rates even when the org hid prices from techs", () => {
      const result = redactMoneyForTech(makeDto(), false, FIELD_SURFACE_REDACTION);
      expect(result.addons[0]?.rate?.cents).toBe(12000);
    });

    it("still strips addon COST — the margin is never a tech's business", () => {
      const result = redactMoneyForTech(makeDto(), false, FIELD_SURFACE_REDACTION);
      expect(result.addons[0]?.cost).toBeNull();
    });

    it("changes nothing else: job lines and the total stay hidden", () => {
      const result = redactMoneyForTech(makeDto(), false, FIELD_SURFACE_REDACTION);
      expect(result.lines[0]?.rate).toBeNull();
      expect(result.lines[0]?.cost).toBeNull();
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
