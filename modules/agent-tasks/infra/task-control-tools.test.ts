import { describe, it, expect, beforeEach } from "vitest";
import { asAgentTaskId } from "@mallet/shared/types";
import { buildTaskControlTools } from "./task-control-tools";
import { MIN_STEP_MINUTES, TICK_CADENCE_MINUTES } from "../app/agent-task-config";

const TASK = asAgentTaskId("ffffffff-ffff-ffff-ffff-ffffffffffff");
const NOW = new Date("2026-08-20T17:00:00Z");

describe("buildTaskControlTools", () => {
  let tools: ReturnType<typeof buildTaskControlTools>;

  beforeEach(() => {
    tools = buildTaskControlTools(TASK, { now: () => NOW });
  });

  it("offers exactly two tools, neither of them mutating", () => {
    expect(tools.meta.map((m) => m.name)).toEqual(["schedule_next_step", "finish_task"]);
    expect(tools.meta.every((m) => m.mutating === false)).toBe(true);
  });

  it("tells the model the real scheduler resolution so it stops over-promising", () => {
    const schedule = tools.meta.find((m) => m.name === "schedule_next_step");
    expect(schedule?.description).toContain(String(TICK_CADENCE_MINUTES));
  });

  it("records a scheduled next step and reports the time it actually got", async () => {
    const out = await tools.handle("schedule_next_step", {
      when: "2026-08-21T16:00:00Z",
      note: "check whether they replied",
    });
    expect(out.ok).toBe(true);
    expect(tools.outcome()).toEqual({
      kind: "scheduled",
      at: new Date("2026-08-21T16:00:00Z"),
      note: "check whether they replied",
    });
  });

  it("clamps a too-soon request and says so in the result", async () => {
    const out = await tools.handle("schedule_next_step", { when: "2026-08-20T17:00:30Z", note: "now!" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.summary).toContain(String(MIN_STEP_MINUTES));
    const outcome = tools.outcome();
    expect(outcome.kind).toBe("scheduled");
  });

  it("records a finish with its summary", async () => {
    const out = await tools.handle("finish_task", { summary: "Sent the follow-up; they booked Thursday." });
    expect(out.ok).toBe(true);
    expect(tools.outcome()).toEqual({
      kind: "finished",
      summary: "Sent the follow-up; they booked Thursday.",
    });
  });

  it("ignores a second pacing call in the same turn — the first one decided", async () => {
    await tools.handle("finish_task", { summary: "done" });
    const second = await tools.handle("schedule_next_step", { when: "2026-08-25T09:00:00Z", note: "more" });
    expect(second.ok).toBe(false);
    expect(tools.outcome()).toEqual({ kind: "finished", summary: "done" });
  });

  it("self-corrects on bad input rather than throwing", async () => {
    const out = await tools.handle("schedule_next_step", { note: "no when at all" });
    expect(out.ok).toBe(false);
    expect(tools.outcome().kind).toBe("none");
  });

  it("refuses a name it does not own", async () => {
    const out = await tools.handle("invoice_send", {});
    expect(out.ok).toBe(false);
  });
});
