// Unit tests for the field copilot system prompt builder.
//
// Key assertions:
// - Redacted variant contains the hard no-prices rule
// - The prompt emits NO found-work marker and never claims to have staged anything
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

    // The marker is gone: change orders are how a tech proposes extra work, so a second
    // pipeline that staged add-ons from a chat reply was retired with it.
    it("never emits a found-work marker", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).not.toContain("FOUND WORK");
      }
    });

    // The dangerous failure is not silence, it is a false claim: a tech told the office already
    // knows will walk off the job without raising anything.
    it("points out-of-scope work at a change order and forbids claiming it was staged", () => {
      for (const seesPrice of [true, false]) {
        const prompt = buildFieldPrompt({ seesPrice });
        expect(prompt, `seesPrice=${seesPrice}`).toContain("change order");
        expect(prompt, `seesPrice=${seesPrice}`).toContain("Never say you have added, staged, or sent anything.");
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

  });

  describe("seesPrice=true — price rule is absent", () => {
    it("does NOT contain the PRICE RULE block", () => {
      const prompt = buildFieldPrompt({ seesPrice: true });
      expect(prompt).not.toContain("PRICE RULE");
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

  describe("safety", () => {
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

  /** Change orders live on a job. With none open there is nothing to point the tech at. */
  it("withholds the change-order instruction, which has nothing to attach to", () => {
    expect(noJob).not.toContain("change order");
  });

  it("keeps every guardrail that has nothing to do with a job", () => {
    expect(noJob).toMatch(/gas leak/i);
    expect(noJob).toMatch(/PLAIN TEXT ONLY/);
    const hidden = buildFieldPrompt({ seesPrice: false, hasJob: false });
    expect(hidden).toMatch(/PRICE RULE \(strict\)/);
  });

  it("hasJob defaults true — the in-job prompt is what an omitted flag builds", () => {
    expect(buildFieldPrompt({ seesPrice: true })).toBe(buildFieldPrompt({ seesPrice: true, hasJob: true }));
    expect(buildFieldPrompt({ seesPrice: true })).toContain("get_my_job");
    expect(buildFieldPrompt({ seesPrice: true })).toContain("change order");
  });
});

/**
 * THE DATE. A copilot that does not know today cannot resolve "tomorrow", "Thursday" or "the
 * 13th" into the YYYY-MM-DD get_my_day needs. Observed before this line existed: asked about
 * "August 13" the model guessed 2025, the tool refused it as out of range, and the model then
 * reasoned from its own wrong guess that the correct date was out of range too.
 */
describe("buildFieldPrompt — today", () => {
  it("states the date with its weekday, and the raw form the tool takes", () => {
    const p = buildFieldPrompt({ seesPrice: true, today: "2026-08-14" });
    expect(p).toContain("Friday");
    expect(p).toContain("14 August 2026");
    expect(p).toContain("2026-08-14");
  });

  it("tells the model to resolve against that date, not its own idea of the year", () => {
    const p = buildFieldPrompt({ seesPrice: true, today: "2026-08-14" });
    expect(p).toMatch(/never against your own assumption of the year/i);
  });

  it("appears on the general chat too — the agenda question lives there", () => {
    const p = buildFieldPrompt({ seesPrice: true, hasJob: false, today: "2026-08-14" });
    expect(p).toContain("2026-08-14");
  });

  it("omits the line rather than inventing a date when none is given", () => {
    expect(buildFieldPrompt({ seesPrice: true })).not.toMatch(/^Today is /m);
  });

  it("omits the line for a malformed date rather than printing Invalid Date", () => {
    const p = buildFieldPrompt({ seesPrice: true, today: "not-a-date" });
    expect(p).not.toContain("Invalid Date");
    expect(p).not.toMatch(/^Today is /m);
  });
});
