import { describe, it, expect } from "vitest";
import type { AgentResult, RiskTier } from "@mallet/ai";
import { decideWake } from "./wake-decision";
import type { AutonomyLevel } from "./autonomy";
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
  // Every pre-existing test below leaves these at the strictest setting — supervised, nothing
  // pending — so a needs_approval result they build still hands over exactly as it did before
  // WakeInput grew these two fields.
  level: "supervised" as AutonomyLevel,
  pendingTiers: [] as { readonly toolUseId: string; readonly tier: RiskTier }[],
};

/** A needs_approval result carrying whatever pending tool_use ids/names a test wants to name. */
const needsApprovalFor = (pending: { toolUseId: string; tool: string }[]): AgentResult => ({
  status: "needs_approval",
  assistantText: "I'd do this",
  pending: pending.map((p) => ({ ...p, input: {} })),
  transcript: [],
  usage: USAGE,
});

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

  describe("autonomy — the runner's four cases", () => {
    it("auto-approves a comms-only turn once the org is assisted", () => {
      const d = decideWake({
        ...base,
        result: needsApprovalFor([{ toolUseId: "c1", tool: "message_send" }]),
        level: "assisted",
        pendingTiers: [{ toolUseId: "c1", tier: "comms" }],
      });
      expect(d).toEqual({ kind: "auto_approve", toolUseIds: ["c1"] });
    });

    it("hands the same comms-only turn over under supervised", () => {
      const d = decideWake({
        ...base,
        result: needsApprovalFor([{ toolUseId: "c1", tool: "message_send" }]),
        level: "supervised",
        pendingTiers: [{ toolUseId: "c1", tier: "comms" }],
      });
      expect(d.kind).toBe("hand_over");
    });

    it("hands over a turn mixing comms and money even when autonomous, naming ONLY the money tool", () => {
      const d = decideWake({
        ...base,
        result: needsApprovalFor([
          { toolUseId: "c1", tool: "message_send" },
          { toolUseId: "m1", tool: "invoice_update" },
        ]),
        level: "autonomous",
        pendingTiers: [
          { toolUseId: "c1", tier: "comms" },
          { toolUseId: "m1", tier: "money" },
        ],
      });
      expect(d.kind).toBe("hand_over");
      // Named specifically, not just "something is pending" — the human has to see WHICH call
      // is the one blocking an otherwise-routine turn. message_send is comms, which autonomous
      // WOULD auto-approve on its own — it is not what stopped this turn, so it must not appear
      // in the note next to the tool that actually did.
      if (d.kind === "hand_over") {
        expect(d.note).toContain("invoice_update");
        expect(d.note).not.toContain("message_send");
      }
    });

    it("names every blocking tool when more than one pending call failed, not just the first", () => {
      const d = decideWake({
        ...base,
        result: needsApprovalFor([
          { toolUseId: "m1", tool: "invoice_update" },
          { toolUseId: "m2", tool: "invoice_void" },
        ]),
        level: "autonomous",
        pendingTiers: [
          { toolUseId: "m1", tier: "money" },
          { toolUseId: "m2", tier: "destructive" },
        ],
      });
      expect(d.kind).toBe("hand_over");
      if (d.kind === "hand_over") {
        expect(d.note).toContain("invoice_update");
        expect(d.note).toContain("invoice_void");
      }
    });

    it("falls back to naming every pending tool when pendingTiers carries no tier info to filter by", () => {
      // pendingTiers empty is the runner's bounded second decide (see the test just below) — there
      // is no tier information to distinguish a "blocking" tool from a fine one, so the note must
      // still say something useful rather than going blank.
      const d = decideWake({
        ...base,
        result: needsApprovalFor([{ toolUseId: "c1", tool: "message_send" }]),
        level: "autonomous",
        pendingTiers: [],
      });
      expect(d.kind).toBe("hand_over");
      if (d.kind === "hand_over") expect(d.note).toContain("message_send");
    });

    it("hands over rather than auto-approving nothing when pendingTiers is empty", () => {
      // The runner passes an empty array on its bounded second round (see agent-task-runner.ts) —
      // this is also what makes that bound work: an empty list can never satisfy `every`-vacuously
      // into an auto_approve.
      const d = decideWake({
        ...base,
        result: needsApprovalFor([{ toolUseId: "c1", tool: "message_send" }]),
        level: "autonomous",
        pendingTiers: [],
      });
      expect(d.kind).toBe("hand_over");
    });
  });
});
