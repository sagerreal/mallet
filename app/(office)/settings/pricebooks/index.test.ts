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

  /**
   * WHICH LINE THE TRACER AUTO-SEEDS.
   *
   * The measurement tracer picks ONE service per measured quantity via `lowestPositionByKind`
   * (modules/quoting/app/build-from-measurements.ts), lowest position wins. SeedPricebookUseCase
   * now passes each service's index as its position, so THE FIRST LINE OF EACH MEASURED KIND IN
   * THE FILE is what gets auto-quoted.
   *
   * That used to be nobody's decision: every seeded service got position 0, and the tie-break
   * fell through to name-alphabetical. A traced gutter run auto-seeded "Copper gutter
   * installation" at $50/ln ft — 20x the aluminum line — with no human involved.
   *
   * These expectations are the deliberate default per kind. Changing one means changing what a
   * shop gets quoted before it touches anything, so it should be a conscious edit here too.
   */
  const AUTO_SEEDED: Record<string, Record<string, string>> = {
    roofing:  { site_sqft: "Tear-off & replace — architectural/dimensional shingle" },
    siding:   { site_sqft: "Vinyl siding installation — standard" },
    gutters:  { site_lnft: "Seamless aluminum gutter installation" },
    fencing:  { site_lnft: "Wood privacy fence — 6ft (per linear ft)" },
    concrete: { site_sqft: "Concrete driveway — broom finish (per sqft)" },
    painting: { walls_sqft: "Interior wall painting (2 coats)" },
  };

  it("auto-seeds the option a shop sells most of, not whichever sorts first", () => {
    for (const [trade, expected] of Object.entries(AUTO_SEEDED)) {
      const pack = pricebookFor(trade);
      expect(pack, `no pack for ${trade}`).toBeTruthy();
      for (const [kind, name] of Object.entries(expected)) {
        const first = pack!.services.find((s) => s.measuredBy === kind);
        expect(first?.name, `${trade}/${kind} auto-seeds the wrong line`).toBe(name);
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
