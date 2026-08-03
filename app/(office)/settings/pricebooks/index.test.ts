import { describe, it, expect } from "vitest";
import { pricebookFor, SEEDED_TRADES } from "./index";
import { TRADE_PLAYBOOKS } from "../trade-playbooks";

/**
 * Which catalogue a shop gets when it seeds its pricebook.
 *
 * Before this registry the seed route was hard-coded to the plumbing pack, so a roofing shop that
 * pressed the button got "Replace 40gal gas water heater · $2,400". The fix is not a better
 * default — it is that there is no default at all.
 */

describe("pricebookFor", () => {
  it("returns the pack for a trade that has one", () => {
    expect(pricebookFor("plumbing")?.key).toBe("plumbing");
  });

  // THE RULE. A trade with no pack seeds NOTHING. Falling back to another trade's prices is the
  // bug this replaced, and an empty pricebook is honest where a wrong one is not.
  it("returns nothing for a trade with no pack, rather than another trade's prices", () => {
    expect(pricebookFor("nonesuch")).toBeUndefined();
  });

  it("never seeds anything for Other — a shop that would not name its trade gets no guesses", () => {
    expect(pricebookFor("other")).toBeUndefined();
  });

  it("keys every pack to a real trade, so the vocabulary matches the playbooks", () => {
    const tradeKeys = new Set(TRADE_PLAYBOOKS.map((t) => t.key));
    for (const key of SEEDED_TRADES) expect(tradeKeys).toContain(key);
  });

  it("prices every line in whole cents — a fractional cent means a unit conversion went wrong", () => {
    for (const key of SEEDED_TRADES) {
      for (const svc of pricebookFor(key)!.services) {
        expect(Number.isInteger(svc.unitPriceCents), `${key}/${svc.name} price`).toBe(true);
        expect(Number.isInteger(svc.costCents), `${key}/${svc.name} cost`).toBe(true);
        expect(svc.unitPriceCents).toBeGreaterThan(0);
      }
    }
  });

  /**
   * A trip fee's cost is a loaded technician hour including drive time. Seeded at zero, every
   * margin rollup reports these as pure profit — the same species of dishonesty as an invented
   * price, and harder to spot because the number looks deliberate.
   */
  it("never seeds a zero cost — nothing a shop sells is free to deliver", () => {
    for (const key of SEEDED_TRADES) {
      for (const svc of pricebookFor(key)!.services) {
        expect(svc.costCents, `${key}/${svc.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("never seeds a price below cost", () => {
    for (const key of SEEDED_TRADES) {
      for (const svc of pricebookFor(key)!.services) {
        expect(svc.unitPriceCents, `${key}/${svc.name}`).toBeGreaterThan(svc.costCents);
      }
    }
  });

  it("files every line under a category the pack actually declares", () => {
    for (const key of SEEDED_TRADES) {
      const pack = pricebookFor(key)!;
      for (const svc of pack.services) {
        expect(pack.categories, `${key}/${svc.name}`).toContain(svc.categoryName);
      }
    }
  });
});
