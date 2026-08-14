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

/**
 * THE ASK TAB IS A GENERAL CHAT. A tech opens it between calls, in the van, or before the first
 * job of the day. With no job open the model has no `get_my_job` and no `get_callback_history` in
 * its registry, so a prompt that orders it to "call get_my_job first" sends it after a tool that
 * does not exist — and one that says its advice is "grounded in THIS job" invites it to answer as
 * though it can see a scope it cannot.
 */
describe("buildFieldPrompt — no job open", () => {
  const noJob = buildFieldPrompt({ seesPrice: true, hasJob: false });

  it("does not order the model to call a tool it was not given", () => {
    expect(noJob).not.toContain("get_my_job");
    expect(noJob).not.toContain("get_callback_history");
  });

  it("keeps the one tool that is org-scoped rather than job-scoped", () => {
    expect(noJob).toContain("get_org_service_context");
  });

  it("says plainly that there is no job, so the model does not invent one", () => {
    expect(noJob).toMatch(/No specific job is open/i);
    expect(noJob).toMatch(/do not claim to see a scope/i);
  });

  it("names the way back to job-specific help instead of guessing", () => {
    expect(noJob).toMatch(/open the job and ask again/i);
  });

  /** FOUND WORK stages an add-on against a job. With none open there is nothing to attach it to. */
  it("withholds the FOUND WORK marker, which has nowhere to land", () => {
    expect(noJob).not.toContain("FOUND WORK");
  });

  it("keeps every guardrail that has nothing to do with a job", () => {
    expect(noJob).toMatch(/gas leak/i);
    expect(noJob).toMatch(/PLAIN TEXT ONLY/);
    const hidden = buildFieldPrompt({ seesPrice: false, hasJob: false });
    expect(hidden).toMatch(/PRICE RULE \(strict\)/);
  });

  it("leaves the in-job prompt exactly as it was — hasJob defaults true", () => {
    expect(buildFieldPrompt({ seesPrice: true })).toBe(buildFieldPrompt({ seesPrice: true, hasJob: true }));
    expect(buildFieldPrompt({ seesPrice: true })).toContain("get_my_job");
    expect(buildFieldPrompt({ seesPrice: true })).toContain("FOUND WORK");
  });
});
