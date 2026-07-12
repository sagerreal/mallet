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
  svc: null,
  status: "scheduled",
  scheduledStart: null,
  scheduledEnd: null,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  total: zeroMoney,
  notes: null,
  checklist: null,
  visits: [],
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

describe("Job.patchFields", () => {
  const baseNow = new Date("2026-07-10T12:00:00Z");
  const makeJob = () => {
    const r = Job.create({
      id: asJobId("11111111-1111-1111-1111-111111111111"),
      orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
      num: "JOB-1000",
      leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
      sourceEstimateId: null,
      assigneeUserId: null,
      title: "Original",
      svc: "service",
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: null,
      checklist: null,
      visits: [],
      createdAt: baseNow,
      updatedAt: baseNow,
    });
    if (!isOk(r)) throw new Error("setup failed");
    return r.value;
  };

  it("patches title/svc/notes and bumps updatedAt", () => {
    const later = new Date("2026-07-10T13:00:00Z");
    const r = makeJob().patchFields({ title: "New", svc: "estimate", notes: "gate code 4" }, later);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBe("New");
      expect(r.value.props.svc).toBe("estimate");
      expect(r.value.props.notes).toBe("gate code 4");
      expect(r.value.props.updatedAt).toBe(later);
    }
  });

  it("undefined field keeps the current value; explicit null clears it", () => {
    const r = makeJob().patchFields({ title: null }, baseNow);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBeNull();
      expect(r.value.props.svc).toBe("service"); // untouched
    }
  });

  it("attaches a checklist, keeps it on unrelated patches, and detaches with null", () => {
    const checklist = {
      name: "Before you leave",
      items: [{ id: "i1", text: "Photo of the valve", type: "photo" as const, required: true }],
    };
    const attached = makeJob().patchFields({ checklist }, baseNow);
    expect(isOk(attached)).toBe(true);
    if (!isOk(attached)) return;
    expect(attached.value.props.checklist?.name).toBe("Before you leave");
    expect(attached.value.props.checklist?.items).toHaveLength(1);

    // undefined keeps the attached checklist.
    const kept = attached.value.patchFields({ title: "Renamed" }, baseNow);
    expect(isOk(kept) && kept.value.props.checklist?.name).toBe("Before you leave");

    // explicit null detaches.
    const detached = attached.value.patchFields({ checklist: null }, baseNow);
    expect(isOk(detached) && detached.value.props.checklist).toBeNull();
  });
});

describe("Job.create — checklist validation", () => {
  const item = (over: Partial<{ id: string; text: string; type: "check" | "photo"; required: boolean }> = {}) => ({
    id: "i1",
    text: "Test water pressure",
    type: "check" as const,
    required: false,
    ...over,
  });

  it("accepts a valid checklist and trims name + item text", () => {
    const r = Job.create(
      props({
        checklist: {
          name: "  Repipe close-out  ",
          items: [item({ text: "  Photo of the manifold  ", type: "photo", required: true })],
        },
      }),
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.checklist?.name).toBe("Repipe close-out");
      expect(r.value.props.checklist?.items[0]).toEqual({
        id: "i1",
        text: "Photo of the manifold",
        type: "photo",
        required: true,
      });
    }
  });

  it("accepts an empty items list (name-only checklist)", () => {
    const r = Job.create(props({ checklist: { name: "Walkthrough", items: [] } }));
    expect(isOk(r) && r.value.props.checklist?.items).toEqual([]);
  });

  it("rejects a blank or over-long name", () => {
    expect(Job.create(props({ checklist: { name: "  ", items: [] } })).ok).toBe(false);
    expect(Job.create(props({ checklist: { name: "x".repeat(101), items: [] } })).ok).toBe(false);
  });

  it("rejects more than 50 items", () => {
    const items = Array.from({ length: 51 }, (_, i) => item({ id: `i${i}` }));
    expect(Job.create(props({ checklist: { name: "Big", items } })).ok).toBe(false);
  });

  it("rejects an item with a missing id, blank text, over-long text, or unknown type", () => {
    expect(Job.create(props({ checklist: { name: "C", items: [item({ id: " " })] } })).ok).toBe(false);
    expect(Job.create(props({ checklist: { name: "C", items: [item({ text: "  " })] } })).ok).toBe(false);
    expect(
      Job.create(props({ checklist: { name: "C", items: [item({ text: "x".repeat(201) })] } })).ok,
    ).toBe(false);
    expect(
      Job.create(props({ checklist: { name: "C", items: [item({ type: "video" as never })] } })).ok,
    ).toBe(false);
  });

  it("rejects structurally corrupt jsonb (items not an array) instead of coercing", () => {
    expect(
      Job.create(props({ checklist: { name: "C", items: "oops" as never } })).ok,
    ).toBe(false);
  });
});
