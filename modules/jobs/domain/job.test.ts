import { describe, it, expect } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asUserId,
  zeroMoney,
  money,
  isOk,
} from "@mallet/shared/types";
import { Job, type JobProps } from "./job";

const props = (overrides: Partial<JobProps> = {}): JobProps => ({
  id: asJobId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  num: "JOB-1000",
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  sourceEstimateId: null,
  assigneeUserId: null,
  title: "Deck rebuild",
  status: "scheduled",
  scheduledStart: null,
  scheduledEnd: null,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  total: zeroMoney,
  notes: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
  ...overrides,
});

const make = (overrides: Partial<JobProps> = {}): Job => {
  const r = Job.create(props(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const now = new Date("2026-06-10T00:00:00Z");

describe("Job.create", () => {
  it("rejects blank num, unknown status, negative total, bad window, canceled-without-reason", () => {
    expect(Job.create(props({ num: " " })).ok).toBe(false);
    expect(Job.create(props({ status: "bogus" as never })).ok).toBe(false);
    expect(Job.create(props({ total: money(-1) })).ok).toBe(false);
    expect(
      Job.create(
        props({
          scheduledStart: new Date("2026-06-10T10:00:00Z"),
          scheduledEnd: new Date("2026-06-10T09:00:00Z"),
        }),
      ).ok,
    ).toBe(false);
    expect(Job.create(props({ status: "canceled", cancelReason: null })).ok).toBe(false);
  });
});

describe("Job state machine", () => {
  it("starts only from scheduled and is idempotent when already in progress", () => {
    const started = make().start(now);
    expect(isOk(started) && started.value.props.status).toBe("in_progress");
    if (isOk(started)) {
      expect(started.value.props.startedAt?.toISOString()).toBe(now.toISOString());
      const again = started.value.start(new Date("2026-06-11T00:00:00Z"));
      expect(isOk(again) && again.value).toBe(started.value); // no-op, same instance
    }
  });

  it("completes only from in_progress", () => {
    expect(make().complete(now).ok).toBe(false); // scheduled -> complete rejected
    const started = make().start(now);
    if (!isOk(started)) throw new Error("start failed");
    const done = started.value.complete(now);
    expect(isOk(done) && done.value.props.status).toBe("complete");
  });

  it("cancels from scheduled or in_progress but not once terminal", () => {
    const canceled = make().cancel("customer bailed", now);
    expect(isOk(canceled) && canceled.value.props.status).toBe("canceled");
    if (isOk(canceled)) {
      expect(canceled.value.props.cancelReason).toBe("customer bailed");
      expect(canceled.value.cancel("again", now).ok).toBe(false); // terminal
    }
    const started = make().start(now);
    if (!isOk(started)) throw new Error("start failed");
    const doneThenCancel = started.value.complete(now);
    if (!isOk(doneThenCancel)) throw new Error("complete failed");
    expect(doneThenCancel.value.cancel("nope", now).ok).toBe(false);
  });

  it("requires a non-empty cancel reason", () => {
    expect(make().cancel("   ", now).ok).toBe(false);
  });

  it("schedules a window only when not terminal and end >= start", () => {
    const s = new Date("2026-06-12T09:00:00Z");
    const e = new Date("2026-06-12T12:00:00Z");
    const scheduled = make().schedule(s, e, now);
    expect(isOk(scheduled) && scheduled.value.props.scheduledStart?.toISOString()).toBe(
      s.toISOString(),
    );
    expect(make().schedule(e, s, now).ok).toBe(false); // end before start
    const canceled = make().cancel("x", now);
    if (!isOk(canceled)) throw new Error("cancel failed");
    expect(canceled.value.schedule(s, e, now).ok).toBe(false); // terminal
  });

  it("assigns and clears an assignee but not once terminal", () => {
    const user = asUserId("99999999-9999-9999-9999-999999999999");
    const assigned = make().assignTo(user, now);
    expect(isOk(assigned) && assigned.value.props.assigneeUserId).toBe(user);
    if (isOk(assigned)) {
      const cleared = assigned.value.assignTo(null, now);
      expect(isOk(cleared) && cleared.value.props.assigneeUserId).toBeNull();
    }
    const canceled = make().cancel("x", now);
    if (!isOk(canceled)) throw new Error("cancel failed");
    expect(canceled.value.assignTo(user, now).ok).toBe(false);
  });
});
