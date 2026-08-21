import { describe, it, expect } from "vitest";
import { asAgentTaskId, asOrgId, asUserId, isOk, type OrgId } from "@mallet/shared/types";
import { AgentTask, type AgentTaskProps } from "./agent-task";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const NOW = new Date("2026-08-20T17:00:00Z");
const LATER = new Date("2026-08-21T17:00:00Z");

const baseProps = (over: Partial<AgentTaskProps> = {}): AgentTaskProps => ({
  id: asAgentTaskId("ffffffff-ffff-ffff-ffff-ffffffffffff"),
  orgId: ORG,
  title: "Follow up with the Hendersons",
  status: "working",
  nextActionAt: null,
  nextActionNote: null,
  origin: "chat",
  createdBy: asUserId("11111111-1111-4111-8111-111111111111"),
  createdByRole: "owner",
  version: 0,
  attempts: 0,
  lastError: null,
  leaseId: null,
  lockedUntil: null,
  transcriptBytes: 0,
  stepsTaken: 0,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  ...over,
});

const built = (over: Partial<AgentTaskProps> = {}): AgentTask => {
  const r = AgentTask.create(baseProps(over));
  if (!isOk(r)) throw new Error(`fixture invalid: ${r.error.message}`);
  return r.value;
};

describe("AgentTask.create", () => {
  it("accepts a well-formed task", () => {
    expect(isOk(AgentTask.create(baseProps()))).toBe(true);
  });

  it("refuses an empty title", () => {
    const r = AgentTask.create(baseProps({ title: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("refuses a title past the cap", () => {
    const r = AgentTask.create(baseProps({ title: "x".repeat(121) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("title");
  });

  it("refuses a note past the cap", () => {
    const r = AgentTask.create(baseProps({ nextActionNote: "x".repeat(281) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("nextActionNote");
  });

  it("refuses a working task that is scheduled in a terminal state", () => {
    const r = AgentTask.create(baseProps({ status: "done", nextActionAt: LATER }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("nextActionAt");
  });

  it("refuses a negative counter", () => {
    const r = AgentTask.create(baseProps({ attempts: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });
});

describe("AgentTask transitions", () => {
  it("schedules the next step and bumps the version", () => {
    const r = built().scheduleNext(LATER, "check whether they replied", NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("working");
      expect(r.value.props.nextActionAt).toEqual(LATER);
      expect(r.value.props.nextActionNote).toBe("check whether they replied");
      expect(r.value.props.stepsTaken).toBe(1);
      expect(r.value.props.version).toBe(1);
      expect(r.value.props.updatedAt).toEqual(NOW);
    }
  });

  it("refuses to schedule a task that is already done", () => {
    const done = built({ status: "done" });
    const r = done.scheduleNext(LATER, "again", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("hands a task to a human, clearing its schedule", () => {
    const t = built({ nextActionAt: LATER }).needsYou("I need your OK to send this", NOW);
    expect(t.props.status).toBe("needs_you");
    expect(t.props.nextActionAt).toBeNull();
    expect(t.props.nextActionNote).toBe("I need your OK to send this");
  });

  it("truncates an over-long note rather than refusing to hand over", () => {
    // needsYou is the failure path — it must never itself fail, or a stuck task is unreachable.
    const t = built().needsYou("x".repeat(400), NOW);
    expect(t.props.nextActionNote?.length).toBe(280);
  });

  it("finishes with a summary and clears the schedule", () => {
    const r = built({ nextActionAt: LATER }).finish("Sent the follow-up; they booked Thursday.", NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("done");
      expect(r.value.props.nextActionAt).toBeNull();
      expect(r.value.props.nextActionNote).toBe("Sent the follow-up; they booked Thursday.");
    }
  });

  it("refuses to finish an already-closed task", () => {
    const r = built({ status: "closed" }).finish("done", NOW);
    expect(r.ok).toBe(false);
  });

  it("resumes a needs_you task immediately and clears the error", () => {
    const r = built({ status: "needs_you", attempts: 3, lastError: "unhandled" }).resume(NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.status).toBe("working");
      expect(r.value.props.nextActionAt).toEqual(NOW);
      expect(r.value.props.attempts).toBe(0);
      expect(r.value.props.lastError).toBeNull();
    }
  });

  it("refuses to resume a finished task — a new ask is a new task", () => {
    const r = built({ status: "done" }).resume(NOW);
    expect(r.ok).toBe(false);
  });

  it("closes a task a human dismissed", () => {
    const r = built({ status: "needs_you" }).close(NOW);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.status).toBe("closed");
  });

  it("records a failed run without ever losing the task", () => {
    const t = built().recordFailure("external_service:anthropic", NOW);
    expect(t.props.attempts).toBe(1);
    expect(t.props.lastError).toBe("external_service:anthropic");
    expect(t.props.status).toBe("working");
  });

  it("hands over instead of poisoning once the attempt budget is spent", () => {
    const t = built({ attempts: 4 }).recordFailure("unhandled", NOW);
    expect(t.props.attempts).toBe(5);
    expect(t.props.status).toBe("needs_you");
    expect(t.props.nextActionNote).toContain("stuck");
  });

  it("refuses to close an already-finished task", () => {
    const r = built({ status: "done" }).close(NOW);
    expect(r.ok).toBe(false);
  });

  it("records transcript bytes as bookkeeping, never a status change", () => {
    const t = built().withTranscriptBytes(1_024, NOW);
    expect(t.props.transcriptBytes).toBe(1_024);
    expect(t.props.status).toBe("working");
    expect(t.props.version).toBe(1);
  });
});
