import { describe, it, expect } from "vitest";
import { buildConsentDescription, buildSampleMessages, buildOptInMessage } from "./generate-consent";
import type { BusinessInfo } from "../domain/registration";

const info = { legalName: "Summit Plumbing", ein: "12-3456789", addressStreet: "", addressCity: "", addressRegion: "", addressPostal: "", industry: "CONSTRUCTION", websiteUrl: "https://summit.example", contactFirstName: "", contactLastName: "", contactEmail: "", contactPhone: "" } as BusinessInfo;

describe("consent generators", () => {
  it("consent description is ≥40 chars, names the business, mentions STOP", () => {
    const c = buildConsentDescription(info);
    expect(c.length).toBeGreaterThanOrEqual(40);
    expect(c).toContain("Summit Plumbing");
    expect(c).toContain("STOP");
  });
  it("produces 5 samples, each branded and containing STOP", () => {
    const s = buildSampleMessages(info);
    expect(s).toHaveLength(5);
    for (const m of s) { expect(m).toContain("Summit Plumbing"); expect(m).toContain("STOP"); }
  });
  it("opt-in message is 20–320 chars with HELP and STOP", () => {
    const m = buildOptInMessage(info);
    expect(m.length).toBeGreaterThanOrEqual(20);
    expect(m.length).toBeLessThanOrEqual(320);
    expect(m).toContain("HELP"); expect(m).toContain("STOP");
  });
});
