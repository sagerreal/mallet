import { describe, it, expect } from "vitest";
import type { AgentResult } from "@mallet/ai";
import { decideWake } from "./wake-decision";
import { MAX_STEPS_PER_TASK, MAX_TRANSCRIPT_BYTES } from "../app/agent-task-config";

const NOW = new Date("2026-08-20T17:00:00Z");
const AT = new Date("2026-08-21T16:00:00Z");
const USAGE = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 };

const completed = (text = "ok"): AgentResult => ({ status: "completed", text, transcript: [], usage: USAGE });
const needsApproval = (): AgentResult => ({
  status: "needs_approval",
  assistantText: "I'd send this",
  pending: [{ toolUseId: "t1", tool: "invoice_send", input: {} }],
  transcript: [],
  usage: USAGE,
});
const refused = (): AgentResult => ({ status: "refused", text: "no", transcript: [], usage: USAGE });

const base = {
  result: completed(),
  control: { kind: "none" } as const,
  stepsTaken: 0,
  transcriptBytes: 0,
  now: NOW,
};

describe("decideWake", () => {
  it("keeps a task working when the agent scheduled its next step", () => {
    const d = decideWake({ ...base, control: { kind: "scheduled", at: AT, note: "check back" } });
    expect(d).toEqual({ kind: "schedule", at: AT, note: "check back" });
  });

  it("finishes a task when the agent closed it out", () => {
    const d = decideWake({ ...base, control: { kind: "finished", summary: "all done" } });
    expect(d).toEqual({ kind: "finish", summary: "all done" });
  });

  it("hands back a completed turn that neither scheduled nor finished", () => {
    // The agent went quiet without saying when it would continue. That is a question, not work.
    const d = decideWake({ ...base, result: completed("Here is what I found.") });
    expect(d.kind).toBe("hand_over");
    if (d.kind === "hand_over") expect(d.note).toBe("Here is what I found.");
  });

  it("hands over on an approval, naming the tools waiting", () => {
    const d = decideWake({ ...base, result: needsApproval() });
    expect(d.kind).toBe("hand_over");
    if (d.kind === "hand_over") expect(d.note).toContain("invoice_send");
  });

  it("hands over when the model refused", () => {
    expect(decideWake({ ...base, result: refused() }).kind).toBe("hand_over");
  });

  it("prefers the agent's own finish over a completed-but-silent turn", () => {
    const d = decideWake({
      ...base,
      result: completed("chatter"),
      control: { kind: "finished", summary: "real outcome" },
    });
    expect(d).toEqual({ kind: "finish", summary: "real outcome" });
  });

  it("stops a task that has taken too many steps, whatever it asked for", () => {
    const d = decideWake({
      ...base,
      stepsTaken: MAX_STEPS_PER_TASK,
      control: { kind: "scheduled", at: AT, note: "again" },
    });
    expect(d.kind).toBe("hand_over");
    if (d.kind === "hand_over") expect(d.note).toContain("steps");
  });

  it("stops a task whose conversation outgrew its ceiling", () => {
    const d = decideWake({
      ...base,
      transcriptBytes: MAX_TRANSCRIPT_BYTES + 1,
      control: { kind: "scheduled", at: AT, note: "again" },
    });
    expect(d.kind).toBe("hand_over");
    if (d.kind === "hand_over") expect(d.note).toContain("long");
  });

  // Branch not exercised by the brief's 8 tests: a completed turn whose text is blank still
  // needs a note a human can read, not an empty string.
  it("falls back to a stock note when a completed turn has nothing to say", () => {
    const d = decideWake({ ...base, result: completed("") });
    expect(d).toEqual({ kind: "hand_over", note: "I stopped without deciding what to do next. Have a look?" });
  });
});
