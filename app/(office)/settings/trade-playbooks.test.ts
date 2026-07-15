import { describe, it, expect } from "vitest";
import { TRADE_PLAYBOOKS, playbookFor } from "./trade-playbooks";

describe("trade starter playbooks", () => {
  it("covers the 10 ICP trades plus Other", () => {
    const keys = TRADE_PLAYBOOKS.map((t) => t.key);
    expect(keys).toEqual([
      "plumbing", "garage_door", "electrical", "tree", "roofing",
      "hvac", "septic", "handyman", "appliance", "fencing", "other",
    ]);
  });

  it("every trade has at least 2 services with valid lanes, names and triggers", () => {
    for (const t of TRADE_PLAYBOOKS) {
      expect(t.services.length).toBeGreaterThanOrEqual(2);
      for (const s of t.services) {
        expect(["repair", "estimate", "flat"]).toContain(s.lane);
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

  it("emergency words only on bookable (repair) services, and never gas (gas = the 911 rule)", () => {
    for (const t of TRADE_PLAYBOOKS) {
      for (const s of t.services) {
        if (s.emergencyTriggers) {
          expect(s.lane).toBe("repair");
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
    for (const key of ["plumbing", "garage_door", "electrical", "roofing", "hvac", "septic"]) {
      const t = playbookFor(key);
      expect(t?.services.some((s) => (s.emergencyTriggers ?? "").length > 0)).toBe(true);
    }
  });

  it("Other is a generic pair: one bookable service call + one quote-first job", () => {
    const other = playbookFor("other");
    expect(other?.services.map((s) => s.lane).sort()).toEqual(["estimate", "repair"]);
  });
});
