import { describe, it, expect } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asUserId,
  asVisitId,
  zeroMoney,
  money,
  isOk,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobProps } from "./job";

const props = (overrides: Partial<JobProps> = {}): JobProps => ({
  id: asJobId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  num: "JOB-1000",
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  sourceEstimateId: null,
  assigneeUserId: null,
  title: "Deck rebuild",
  svc: null,
  kind: "work",
  status: "scheduled",
  scheduledStart: null,
  scheduledEnd: null,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  total: zeroMoney,
  notes: null,
  scope: null,
  callbackOf: null,
  callbackReason: null,
  checklist: null,
  requiredCerts: null,
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

describe("Job kind", () => {
  it('defaults kind to "work" when omitted', () => {
    const { kind: _omitted, ...rest } = props();
    const r = Job.create(rest);
    expect(isOk(r) && r.value.props.kind).toBe("work");
  });

  it("accepts an explicit kind and rejects an unknown one", () => {
    expect(make({ kind: "estimate" }).props.kind).toBe("estimate");
    expect(make({ kind: "work" }).props.kind).toBe("work");
    expect(Job.create(props({ kind: "bogus" as never })).ok).toBe(false);
  });

  it("preserves kind through state transitions and field patches", () => {
    const job = make({ kind: "estimate" });
    const started = job.start(now);
    expect(isOk(started) && started.value.props.kind).toBe("estimate");
    const patched = job.patchFields({ title: "New title" }, now);
    expect(isOk(patched) && patched.value.props.kind).toBe("estimate");
    const assigned = job.assignTo(asUserId("99999999-9999-9999-9999-999999999999"), now);
    expect(isOk(assigned) && assigned.value.props.kind).toBe("estimate");
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

  it("reopens only from complete, returning to in_progress with completedAt cleared", () => {
    const started = make().start(now);
    if (!isOk(started)) throw new Error("start failed");
    const done = started.value.complete(now);
    if (!isOk(done)) throw new Error("complete failed");

    const later = new Date("2026-06-12T00:00:00Z");
    const reopened = done.value.reopen(later);
    expect(isOk(reopened) && reopened.value.props.status).toBe("in_progress");
    if (isOk(reopened)) {
      expect(reopened.value.props.completedAt).toBeNull();
      expect(reopened.value.props.updatedAt.toISOString()).toBe(later.toISOString());
      // and the reopened job can complete again (office endpoint semantics intact)
      const redone = reopened.value.complete(later);
      expect(isOk(redone) && redone.value.props.status).toBe("complete");
    }
  });

  it("rejects reopen from scheduled, in_progress, and canceled", () => {
    expect(make().reopen(now).ok).toBe(false); // scheduled
    const started = make().start(now);
    if (!isOk(started)) throw new Error("start failed");
    expect(started.value.reopen(now).ok).toBe(false); // in_progress
    const canceled = make().cancel("x", now);
    if (!isOk(canceled)) throw new Error("cancel failed");
    expect(canceled.value.reopen(now).ok).toBe(false); // canceled stays terminal
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

  it("rejects a blank or over-long name (bounds match template names: ≤ 200)", () => {
    expect(Job.create(props({ checklist: { name: "  ", items: [] } })).ok).toBe(false);
    // 200 is the template-name max — a max-length template must stay attachable.
    expect(Job.create(props({ checklist: { name: "x".repeat(200), items: [] } })).ok).toBe(true);
    expect(Job.create(props({ checklist: { name: "x".repeat(201), items: [] } })).ok).toBe(false);
  });

  it("rejects more than 50 items", () => {
    const items = Array.from({ length: 51 }, (_, i) => item({ id: `i${i}` }));
    expect(Job.create(props({ checklist: { name: "Big", items } })).ok).toBe(false);
  });

  it("rejects an item with a missing id, blank text, over-long text, or unknown type", () => {
    expect(Job.create(props({ checklist: { name: "C", items: [item({ id: " " })] } })).ok).toBe(false);
    expect(Job.create(props({ checklist: { name: "C", items: [item({ text: "  " })] } })).ok).toBe(false);
    // 500 is the template-item max — a max-length template item must stay attachable.
    expect(
      Job.create(props({ checklist: { name: "C", items: [item({ text: "x".repeat(500) })] } })).ok,
    ).toBe(true);
    expect(
      Job.create(props({ checklist: { name: "C", items: [item({ text: "x".repeat(501) })] } })).ok,
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

describe("Job.create — callbackOf + callbackReason fields", () => {
  it("defaults both to null when omitted from create props", () => {
    // omit the optional fields entirely — JobCreateProps accepts them as optional
    const r = Job.create(props());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.callbackOf).toBeNull();
      expect(r.value.props.callbackReason).toBeNull();
    }
  });

  it("preserves a valid callbackOf + valid callbackReason", () => {
    const callbackOfId = asJobId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const r = Job.create(props({ callbackOf: callbackOfId, callbackReason: "callback" }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.callbackOf).toBe(callbackOfId);
      expect(r.value.props.callbackReason).toBe("callback");
    }
  });

  it("rejects an invalid callbackReason when non-null", () => {
    const callbackOfId = asJobId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const r = Job.create(props({ callbackOf: callbackOfId, callbackReason: "bogus" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("callbackReason");
  });

  it("allows callbackOf set with null reason (unconfirmed candidate link)", () => {
    const callbackOfId = asJobId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const r = Job.create(props({ callbackOf: callbackOfId, callbackReason: null }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.callbackOf).toBe(callbackOfId);
      expect(r.value.props.callbackReason).toBeNull();
    }
  });

  it("accepts all valid CALLBACK_REASONS values", () => {
    const callbackOfId = asJobId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    for (const reason of ["callback", "new_issue", "found_work"] as const) {
      const r = Job.create(props({ callbackOf: callbackOfId, callbackReason: reason }));
      expect(isOk(r)).toBe(true);
    }
  });

  it("existing Job.create sites keep compiling — callbackOf/callbackReason omitted is ok", () => {
    const r = Job.create(props());
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.callbackOf).toBeNull();
      expect(r.value.props.callbackReason).toBeNull();
    }
  });
});

describe("Job.markCallback + Job.dismissCallback", () => {
  const JOB_ID = asJobId("11111111-1111-1111-1111-111111111111");
  const OTHER_ID = asJobId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  const markNow = new Date("2026-07-15T00:00:00Z");

  it("markCallback sets callbackOf + reason and bumps updatedAt", () => {
    const job = make({ id: JOB_ID });
    const r = job.markCallback(OTHER_ID, "callback", markNow);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.callbackOf).toBe(OTHER_ID);
    expect(r.value.props.callbackReason).toBe("callback");
    expect(r.value.props.updatedAt).toBe(markNow);
    // original is unmodified (immutable)
    expect(job.props.callbackOf).toBeNull();
  });

  it("markCallback rejects self-reference", () => {
    const job = make({ id: JOB_ID });
    const r = job.markCallback(JOB_ID, "callback", markNow);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.field).toBe("callbackOf");
    }
  });

  it("markCallback accepts all valid CallbackReasons", () => {
    const job = make({ id: JOB_ID });
    for (const reason of ["callback", "new_issue", "found_work"] as const) {
      const r = job.markCallback(OTHER_ID, reason, markNow);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.props.callbackReason).toBe(reason);
    }
  });

  it("dismissCallback sets callbackReason=new_issue and clears callbackOf", () => {
    const job = make({ id: JOB_ID, callbackOf: OTHER_ID, callbackReason: "callback" });
    const r = job.dismissCallback(markNow);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.callbackOf).toBeNull();
    expect(r.value.props.callbackReason).toBe("new_issue");
    expect(r.value.props.updatedAt).toBe(markNow);
    // original is unmodified (immutable)
    expect(job.props.callbackOf).toBe(OTHER_ID);
  });
});

describe("Job.create — scope field", () => {
  it("defaults scope to null when omitted from create props", () => {
    const { scope: _omitted, ...rest } = props();
    const r = Job.create(rest);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBeNull();
  });

  it("preserves a valid scope string (trimmed)", () => {
    const r = Job.create(props({ scope: "  water heater is ~15 years old, original install  " }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBe("water heater is ~15 years old, original install");
  });

  it("normalizes empty or whitespace-only scope to null", () => {
    expect(isOk(Job.create(props({ scope: "" }))) && Job.create(props({ scope: "" })).ok).toBe(true);
    const emptyR = Job.create(props({ scope: "" }));
    if (isOk(emptyR)) expect(emptyR.value.props.scope).toBeNull();

    const wsR = Job.create(props({ scope: "   " }));
    expect(isOk(wsR)).toBe(true);
    if (isOk(wsR)) expect(wsR.value.props.scope).toBeNull();
  });

  it("passes null scope through as null", () => {
    const r = Job.create(props({ scope: null }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBeNull();
  });

  it("rejects a scope that exceeds SCOPE_MAX_LENGTH (4000 chars)", () => {
    const overMax = "x".repeat(4001);
    const r = Job.create(props({ scope: overMax }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("scope");
  });

  it("accepts exactly SCOPE_MAX_LENGTH characters (4000)", () => {
    const atMax = "x".repeat(4000);
    const r = Job.create(props({ scope: atMax }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBe(atMax);
  });
});

describe("Job requiredCerts", () => {
  it("defaults to null when omitted", () => {
    // No requiredCerts in props → null after Job.create
    const job = make();
    expect(job.props.requiredCerts).toBeNull();
  });

  it("preserves a non-empty cert array", () => {
    const job = make({ requiredCerts: ["gas", "water"] });
    expect(job.props.requiredCerts).toEqual(["gas", "water"]);
  });

  it("normalizes an empty array to null (no-requirement = always null)", () => {
    const job = make({ requiredCerts: [] });
    expect(job.props.requiredCerts).toBeNull();
  });

  it("preserves null explicitly", () => {
    const job = make({ requiredCerts: null });
    expect(job.props.requiredCerts).toBeNull();
  });

  // The board reads visits; My day reads the job. Completing the job used to move only the job, so
  // an open block for finished work sat on the schedule while My day correctly showed nothing —
  // two views of one fact, disagreeing.
  describe("completing a job closes its outstanding visits", () => {
    const withVisits = (statuses: readonly string[]) => {
      const base = make({ status: "in_progress" });
      const visits = statuses.map((status, i) => {
        const v = JobVisit.create({
          id: asVisitId(`00000000-0000-4000-8000-00000000000${i}`),
          assigneeUserId: null,
          scheduledDate: "2026-07-25",
          scheduledStart: "10:00",
          scheduledEnd: "11:30",
          durationMinutes: 90,
          status: status as never,
          enrouteAt: null,
          startedAt: null,
          completedAt: status === "complete" ? new Date("2026-07-24T10:00:00Z") : null,
          notes: null,
          position: i,
        });
        if (!v.ok) throw new Error("fixture");
        return v.value;
      });
      const withV = base.withVisits(visits, new Date("2026-07-25T09:00:00Z"));
      if (!withV.ok) throw new Error("fixture");
      return withV.value;
    };

    it("marks a pending visit complete", () => {
      const now = new Date("2026-07-25T12:00:00Z");
      const done = withVisits(["pending"]).complete(now);
      expect(done.ok).toBe(true);
      if (done.ok) {
        expect(done.value.props.visits[0]!.props.status).toBe("complete");
        expect(done.value.props.visits[0]!.props.completedAt).toEqual(now);
      }
    });

    it("marks an in-progress visit complete", () => {
      const done = withVisits(["in_progress"]).complete(new Date("2026-07-25T12:00:00Z"));
      if (done.ok) expect(done.value.props.visits[0]!.props.status).toBe("complete");
    });

    it("leaves a canceled visit canceled — finishing a job does not un-cancel work", () => {
      const done = withVisits(["canceled"]).complete(new Date("2026-07-25T12:00:00Z"));
      if (done.ok) expect(done.value.props.visits[0]!.props.status).toBe("canceled");
    });

    it("keeps an already-complete visit's own stamp rather than restamping it", () => {
      const done = withVisits(["complete"]).complete(new Date("2026-07-25T12:00:00Z"));
      if (done.ok) {
        expect(done.value.props.visits[0]!.props.completedAt).toEqual(new Date("2026-07-24T10:00:00Z"));
      }
    });

    it("closes every open visit on a multi-visit job", () => {
      const done = withVisits(["pending", "canceled", "pending"]).complete(new Date("2026-07-25T12:00:00Z"));
      if (done.ok) {
        expect(done.value.props.visits.map((v) => v.props.status)).toEqual([
          "complete", "canceled", "complete",
        ]);
      }
    });
  });
});
