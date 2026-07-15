import { describe, it, expect } from "vitest";
import { deriveSetupSteps, setupComplete } from "./setup";

const base = {
  servicesCount: 0,
  originAddress: "",
  hasFieldCrew: false,
  hasAiLead: false,
};

describe("deriveSetupSteps", () => {
  it("a fresh org has all four steps undone", () => {
    const steps = deriveSetupSteps(base);
    expect(steps).toHaveLength(4);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(setupComplete(steps)).toBe(false);
  });

  it("each step derives from its own input", () => {
    expect(deriveSetupSteps({ ...base, servicesCount: 3 }).find((s) => s.key === "services")?.done).toBe(true);
    expect(deriveSetupSteps({ ...base, originAddress: "200 Ray St" }).find((s) => s.key === "area")?.done).toBe(true);
    expect(deriveSetupSteps({ ...base, hasFieldCrew: true }).find((s) => s.key === "crew")?.done).toBe(true);
    expect(deriveSetupSteps({ ...base, hasAiLead: true }).find((s) => s.key === "first-call")?.done).toBe(true);
  });

  it("a whitespace-only address does not count as set", () => {
    expect(deriveSetupSteps({ ...base, originAddress: "   " }).find((s) => s.key === "area")?.done).toBe(false);
  });

  it("setupComplete is true only when every step is done", () => {
    const steps = deriveSetupSteps({
      servicesCount: 5,
      originAddress: "200 Ray St, Pleasanton",
      hasFieldCrew: true,
      hasAiLead: true,
    });
    expect(setupComplete(steps)).toBe(true);
  });

  it("every step deep-links somewhere real", () => {
    for (const s of deriveSetupSteps(base)) {
      expect(s.href.startsWith("/settings")).toBe(true);
    }
  });
});
