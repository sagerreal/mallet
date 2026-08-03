import { describe, it, expect } from "vitest";
import { TRADE_PLAYBOOKS, playbookFor } from "./trade-playbooks";

describe("trade starter playbooks", () => {
  /**
   * The list IS the positioning. Service trades first (priced per job), then the
   * measurement-priced ones (priced off site_sqft / site_lnft / room quantities), then Other.
   * Garage door, tree service, septic, handyman and appliance repair were removed deliberately:
   * offering a trade in this dropdown implies the rest of the product was built around it.
   */
  it("covers the four service trades, the six measured trades, and Other — in that order", () => {
    const keys = TRADE_PLAYBOOKS.map((t) => t.key);
    expect(keys).toEqual([
      "hvac", "mechanical", "electrical", "plumbing",
      "roofing", "painting", "fencing", "concrete", "siding", "gutters",
      "other",
    ]);
  });

  it("offers no trade the product was not built around", () => {
    const keys = TRADE_PLAYBOOKS.map((t) => t.key);
    for (const dropped of ["garage_door", "tree", "septic", "handyman", "appliance"]) {
      expect(keys).not.toContain(dropped);
    }
  });

  it("every trade has at least 2 services with valid lanes, names and triggers", () => {
    for (const t of TRADE_PLAYBOOKS) {
      expect(t.services.length).toBeGreaterThanOrEqual(2);
      for (const s of t.services) {
        expect(["estimate", "flat"]).toContain(s.lane);
        expect(s.name.trim().length).toBeGreaterThan(0);
        expect(s.triggers.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never seeds a price: no flat lanes and no $ tokens anywhere (redaction hygiene)", () => {
    for (const t of TRADE_PLAYBOOKS) {
      for (const s of t.services) {
        expect(s.lane).not.toBe("flat"); // prices are the owner's — we never seed one
        expect(s.price).toBeUndefined();
        expect(s.ballpark).toBeUndefined();
        expect(s.triggers).not.toMatch(/\$/);
        expect(s.emergencyTriggers ?? "").not.toMatch(/\$/);
      }
    }
  });

  it("emergency words only on fee visits — someone who will FIX it — and never gas (the 911 rule)", () => {
    for (const t of TRADE_PLAYBOOKS) {
      for (const s of t.services) {
        if (s.emergencyTriggers) {
          // An emergency caller needs a tech who prices and fixes on site: the fee visit.
          expect(s.lane).toBe("estimate");
          expect(s.feeApplies).toBe(true);
          expect(s.emergencyTriggers.toLowerCase()).not.toMatch(/\bgas\b/);
        }
      }
    }
  });

  it("service names are unique within each trade (seed dedupe key)", () => {
    for (const t of TRADE_PLAYBOOKS) {
      const names = t.services.map((s) => s.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("the emergency-heavy ICP trades ship emergency words out of the box", () => {
    // Painting and concrete are absent on purpose: a repaint is never an emergency, and
    // inventing urgency words for one would teach the front desk to escalate a nothing.
    for (const key of ["plumbing", "electrical", "roofing", "hvac", "mechanical", "siding", "gutters"]) {
      const t = playbookFor(key);
      expect(t?.services.some((s) => (s.emergencyTriggers ?? "").length > 0)).toBe(true);
    }
  });

  it("Other is a generic pair: one fee visit + one free quote-first estimate", () => {
    const other = playbookFor("other");
    expect(other?.services.every((s) => s.lane === "estimate")).toBe(true);
    expect(other?.services.map((s) => s.feeApplies === true).sort()).toEqual([false, true]);
  });
});
