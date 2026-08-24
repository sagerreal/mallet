import { describe, it, expect } from "vitest";
import type { RiskTier } from "@mallet/ai";
import { autoApproves, canRunUnattended, AUTONOMY_LEVELS, type AutonomyLevel } from "./autonomy";

const TIERS: RiskTier[] = ["comms", "operational", "money", "destructive"];

describe("autoApproves", () => {
  it("asks for everything under supervision", () => {
    for (const tier of TIERS) expect(autoApproves(tier, "supervised")).toBe(false);
  });

  it("lets comms and operational through when assisted", () => {
    expect(autoApproves("comms", "assisted")).toBe(true);
    expect(autoApproves("operational", "assisted")).toBe(true);
  });

  it("NEVER auto-approves money or destructive, at any level", () => {
    // The load-bearing invariant of the whole feature. If this test ever needs changing, the
    // change is a product decision Owen makes, not a refactor.
    for (const level of AUTONOMY_LEVELS) {
      expect(autoApproves("money", level)).toBe(false);
      expect(autoApproves("destructive", level)).toBe(false);
    }
  });

  it("gives autonomous the same tier set as assisted", () => {
    for (const tier of TIERS) {
      expect(autoApproves(tier, "autonomous")).toBe(autoApproves(tier, "assisted"));
    }
  });

  it("treats an unrecognised level as supervised", () => {
    expect(autoApproves("comms", "nonsense" as AutonomyLevel)).toBe(false);
  });
});

describe("canRunUnattended", () => {
  it("is what actually separates autonomous from assisted", () => {
    expect(canRunUnattended("supervised")).toBe(false);
    expect(canRunUnattended("assisted")).toBe(false);
    expect(canRunUnattended("autonomous")).toBe(true);
  });
});
