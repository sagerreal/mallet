import { describe, it, expect } from "vitest";
import {
  deriveSetupSteps,
  stepsByTier,
  tierComplete,
  setupComplete,
  doneCount,
  type SetupInputs,
} from "./setup";

const blank: SetupInputs = {
  servicesCount: 0,
  originAddress: "",
  phoneAcked: false,
  hasAiLead: false,
  pricebookCount: 0,
  hasMarketplace: false,
  hasWebsiteForm: false,
  hasFieldCrew: false,
};

describe("deriveSetupSteps", () => {
  it("a fresh org has 8 steps, all undone, across two tiers", () => {
    const steps = deriveSetupSteps(blank);
    expect(steps).toHaveLength(8);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(stepsByTier(steps, "live")).toHaveLength(4);
    expect(stepsByTier(steps, "grow")).toHaveLength(4);
  });

  it("the live tier is the required path to the first test call, in order", () => {
    expect(stepsByTier(deriveSetupSteps(blank), "live").map((s) => s.key)).toEqual([
      "services", "office", "phone", "test-call",
    ]);
  });

  it("each step derives from its own input", () => {
    const one = (over: Partial<SetupInputs>, key: string) =>
      deriveSetupSteps({ ...blank, ...over }).find((s) => s.key === key)?.done;
    expect(one({ servicesCount: 3 }, "services")).toBe(true);
    expect(one({ originAddress: "200 Ray St" }, "office")).toBe(true);
    expect(one({ phoneAcked: true }, "phone")).toBe(true);
    expect(one({ hasAiLead: true }, "test-call")).toBe(true);
    expect(one({ pricebookCount: 12 }, "pricebook")).toBe(true);
    expect(one({ hasMarketplace: true }, "marketplaces")).toBe(true);
    expect(one({ hasWebsiteForm: true }, "website-form")).toBe(true);
    expect(one({ hasFieldCrew: true }, "crew")).toBe(true);
  });

  it("a whitespace-only office address does not count", () => {
    expect(deriveSetupSteps({ ...blank, originAddress: "   " }).find((s) => s.key === "office")?.done).toBe(false);
  });
});

describe("tier + completion helpers", () => {
  const liveDone: SetupInputs = { ...blank, servicesCount: 2, originAddress: "x", phoneAcked: true, hasAiLead: true };

  it("tierComplete('live') flips only when all four live steps are done", () => {
    expect(tierComplete(deriveSetupSteps(blank), "live")).toBe(false);
    expect(tierComplete(deriveSetupSteps(liveDone), "live")).toBe(true);
    // grow still incomplete → whole card not done
    expect(setupComplete(deriveSetupSteps(liveDone))).toBe(false);
  });

  it("setupComplete is true only when BOTH tiers are fully done", () => {
    const all: SetupInputs = {
      ...liveDone, pricebookCount: 5, hasMarketplace: true, hasWebsiteForm: true, hasFieldCrew: true,
    };
    expect(setupComplete(deriveSetupSteps(all))).toBe(true);
  });

  it("doneCount counts across both tiers", () => {
    expect(doneCount(deriveSetupSteps(liveDone))).toBe(4);
  });
});
