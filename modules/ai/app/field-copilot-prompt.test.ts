// Unit tests for the field copilot system prompt builder.
//
// Key assertions:
// - Redacted variant contains the hard no-prices rule
// - FOUND WORK marker format is documented and enforced by the prompt language
// - Safety escalation language is present
// - Prompt is non-empty and covers key behaviours

import { describe, it, expect } from "vitest";
import { buildFieldPrompt } from "./field-copilot-prompt";

describe("buildFieldPrompt", () => {
  describe("common structure (both seesPrice variants)", () => {
    it("always instructs the model to call get_my_job first", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("get_my_job");
      }
    });

    it("always contains safety escalation language for gas", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("gas");
        expect(prompt, `seesPrice=${seesPrice}`).toContain("STOP");
      }
    });

    it("always contains the FOUND WORK marker format", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("FOUND WORK:");
      }
    });

    it("specifies the description length limit (≤80 chars)", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("80");
      }
    });

    it("specifies one-per-reply max for FOUND WORK marker", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("one per reply max");
      }
    });

    it("mentions get_org_service_context and get_callback_history", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt).toContain("get_org_service_context");
        expect(prompt).toContain("get_callback_history");
      }
    });

    it("is a non-empty string", () => {
      const prompt = buildFieldPrompt({ seesPrice: true });
      expect(prompt.length).toBeGreaterThan(200);
    });
  });

  describe("seesPrice=false — hard no-prices rule", () => {
    it("contains the hard PRICE RULE instruction", () => {
      const prompt = buildFieldPrompt({ seesPrice: false });
      expect(prompt).toContain("PRICE RULE");
    });

    it("instructs the model to NEVER state prices", () => {
      const prompt = buildFieldPrompt({ seesPrice: false });
      expect(prompt.toLowerCase()).toContain("never");
      // Must mention prices in the context of the restriction
      expect(prompt).toContain("prices");
    });

    it("the FOUND WORK instructions note no prices restriction", () => {
      const prompt = buildFieldPrompt({ seesPrice: false });
      // The instruction line before the FOUND WORK format should mention the no-prices constraint
      const instructionLine = prompt
        .split("\n")
        .find((line) => line.includes("80 chars") && line.includes("no prices"));
      expect(instructionLine, "FOUND WORK instruction must mention 'no prices' when !seesPrice").toBeDefined();
    });
  });

  describe("seesPrice=true — price rule is absent", () => {
    it("does NOT contain the PRICE RULE block", () => {
      const prompt = buildFieldPrompt({ seesPrice: true });
      expect(prompt).not.toContain("PRICE RULE");
    });

    it("the FOUND WORK instructions do NOT mention no-prices restriction", () => {
      const prompt = buildFieldPrompt({ seesPrice: true });
      // The instruction line for FOUND WORK should NOT have no-prices when seesPrice=true
      const instructionLine = prompt
        .split("\n")
        .find((line) => line.includes("80 chars"));
      expect(instructionLine, "FOUND WORK 80-char instruction should exist").toBeDefined();
      if (instructionLine) {
        expect(instructionLine).not.toContain("no prices");
      }
    });
  });

  describe("techName", () => {
    it("includes tech name in greeting when provided", () => {
      const prompt = buildFieldPrompt({ seesPrice: true, techName: "Marcus" });
      expect(prompt).toContain("Marcus");
    });

    it("uses generic greeting when techName is omitted", () => {
      const prompt = buildFieldPrompt({ seesPrice: true });
      expect(prompt).not.toContain("Marcus");
      expect(prompt).toContain("field technician");
    });
  });

  describe("FOUND WORK marker contract documentation", () => {
    it("the marker is exactly 'FOUND WORK: {description}'", () => {
      // The contract is that replies end with this exact prefix — verify the prompt
      // communicates the format unambiguously so the PR3 parser can rely on it.
      const prompt = buildFieldPrompt({ seesPrice: false });
      expect(prompt).toMatch(/FOUND WORK: \{[^}]+\}/);
    });

    it("electrical is also mentioned as a safety escalation hazard", () => {
      const prompt = buildFieldPrompt({ seesPrice: false });
      expect(prompt.toLowerCase()).toContain("electrical");
    });
  });
});
