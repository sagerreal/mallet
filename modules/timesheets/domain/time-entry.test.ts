import { describe, it, expect } from "vitest";
import { asTimeEntryId, asUserId, asOrgId, asJobId, isOk } from "@mallet/shared/types";
import { TimeEntry, type TimeEntryProps } from "./time-entry";

const baseProps = (overrides: Partial<TimeEntryProps> = {}): TimeEntryProps => ({
  id: asTimeEntryId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  techUserId: asUserId("33333333-3333-3333-3333-333333333333"),
  jobId: null,
  workDate: "2026-07-07",
  kind: "job",
  startTime: "08:00",
  endTime: "10:00",
  minutes: null,
  note: "",
  src: "manual",
  status: "draft",
  running: false,
  approvedAt: null,
  editedByUserId: null,
  createdAt: new Date("2026-07-07T08:00:00Z"),
  updatedAt: new Date("2026-07-07T08:00:00Z"),
  ...overrides,
});

/** A valid PTO-family entry: a date and a length, no punch times. */
const offProps = (overrides: Partial<TimeEntryProps> = {}): TimeEntryProps =>
  baseProps({ kind: "pto", startTime: null, endTime: null, minutes: 480, ...overrides });

const unwrap = (r: ReturnType<typeof TimeEntry.create>): TimeEntry => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("TimeEntry.create — validation", () => {
  it("accepts valid props", () => {
    const r = TimeEntry.create(baseProps());
    expect(isOk(r)).toBe(true);
  });

  it("rejects invalid kind", () => {
    const r = TimeEntry.create(baseProps({ kind: "nope" as "job" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("kind");
  });

  it("rejects invalid src", () => {
    const r = TimeEntry.create(baseProps({ src: "voice" as "manual" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("src");
  });

  it("rejects invalid status", () => {
    const r = TimeEntry.create(baseProps({ status: "pending" as "draft" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("rejects endTime <= startTime", () => {
    const r = TimeEntry.create(baseProps({ startTime: "10:00", endTime: "09:30" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("endTime");
  });

  it("rejects endTime === startTime", () => {
    const r = TimeEntry.create(baseProps({ startTime: "10:00", endTime: "10:00" }));
    expect(r.ok).toBe(false);
  });

  it("accepts null endTime (running timer)", () => {
    const r = TimeEntry.create(baseProps({ endTime: null, running: true }));
    expect(isOk(r)).toBe(true);
  });

  it("accepts a jobId", () => {
    const r = TimeEntry.create(
      baseProps({ jobId: asJobId("44444444-4444-4444-4444-444444444444") }),
    );
    expect(isOk(r)).toBe(true);
  });
});

describe("TimeEntry.hours()", () => {
  it("returns fractional hours when both times are set", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ startTime: "08:00", endTime: "09:30" })));
    expect(entry.hours()).toBeCloseTo(1.5);
  });

  it("returns null when endTime is null", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ endTime: null })));
    expect(entry.hours()).toBeNull();
  });

  it("returns 0.5 for a 30-minute entry", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ startTime: "12:00", endTime: "12:30" })));
    expect(entry.hours()).toBeCloseTo(0.5);
  });
});

describe("TimeEntry.approve()", () => {
  it("returns a new entry with status=approved and approvedAt set", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ status: "draft" })));
    const now = new Date("2026-07-08T14:00:00Z");
    const approved = entry.approve(now);

    expect(approved.props.status).toBe("approved");
    expect(approved.props.approvedAt?.toISOString()).toBe(now.toISOString());
    // Immutability: original unchanged
    expect(entry.props.status).toBe("draft");
    expect(entry.props.approvedAt).toBeNull();
    // Different instance
    expect(approved).not.toBe(entry);
  });
});

describe("TimeEntry.reopen()", () => {
  it("returns a new entry with status=draft and approvedAt=null", () => {
    const now = new Date("2026-07-09T10:00:00Z");
    const approvedAt = new Date("2026-07-08T14:00:00Z");
    const entry = unwrap(
      TimeEntry.create(baseProps({ status: "approved", approvedAt })),
    );
    const reopened = entry.reopen(now);

    expect(reopened.props.status).toBe("draft");
    expect(reopened.props.approvedAt).toBeNull();
    expect(reopened.props.updatedAt.toISOString()).toBe(now.toISOString());
    // Immutability: original unchanged
    expect(entry.props.status).toBe("approved");
    expect(entry.props.approvedAt?.toISOString()).toBe(approvedAt.toISOString());
    // Different instance
    expect(reopened).not.toBe(entry);
  });
});

describe("TimeEntry.patch()", () => {
  const now = new Date("2026-07-08T10:00:00Z");

  it("patches note and bumps updatedAt", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ note: "old" })));
    const result = entry.patch({ note: "new" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.note).toBe("new");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
      // Immutability: original unchanged
      expect(entry.props.note).toBe("old");
    }
  });

  it("patches kind", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ kind: "job" })));
    const result = entry.patch({ kind: "travel" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.kind).toBe("travel");
  });

  it("rejects a patch that produces invalid endTime", () => {
    const entry = unwrap(TimeEntry.create(baseProps({ startTime: "08:00", endTime: "10:00" })));
    const result = entry.patch({ endTime: "07:00" }, now);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TIME-OFF KINDS. The kind decides the SHAPE: clock kinds carry punch times and never
// minutes; time-off kinds carry minutes and never punch times — an entry that mixes the
// two shapes is corruption and must be impossible to construct.
// ---------------------------------------------------------------------------

describe("TimeEntry.create — time-off kinds", () => {
  const now = new Date("2026-07-08T12:00:00Z");
  it("accepts each time-off kind with a date and minutes only", () => {
    for (const kind of ["pto", "vacation", "sick", "holiday"] as const) {
      const r = TimeEntry.create(offProps({ kind }));
      expect(isOk(r)).toBe(true);
    }
  });

  it("rejects a time-off entry carrying punch times", () => {
    expect(TimeEntry.create(offProps({ startTime: "08:00" })).ok).toBe(false);
    expect(TimeEntry.create(offProps({ endTime: "16:00" })).ok).toBe(false);
  });

  it("rejects a time-off entry with no minutes, zero minutes, or more than a day", () => {
    expect(TimeEntry.create(offProps({ minutes: null })).ok).toBe(false);
    expect(TimeEntry.create(offProps({ minutes: 0 })).ok).toBe(false);
    expect(TimeEntry.create(offProps({ minutes: 1441 })).ok).toBe(false);
    expect(TimeEntry.create(offProps({ minutes: 7.5 })).ok).toBe(false);
  });

  it("rejects a RUNNING time-off entry — there is no clock to a day off", () => {
    expect(TimeEntry.create(offProps({ running: true })).ok).toBe(false);
  });

  it("rejects a clock-kind entry carrying minutes", () => {
    expect(TimeEntry.create(baseProps({ minutes: 60 })).ok).toBe(false);
  });

  it("rejects a clock-kind entry with no startTime", () => {
    expect(TimeEntry.create(baseProps({ startTime: null })).ok).toBe(false);
  });

  it("derives hours from minutes for a time-off entry", () => {
    const entry = unwrap(TimeEntry.create(offProps({ minutes: 450 })));
    expect(entry.hours()).toBe(7.5);
  });

  it("patches a time-off entry's length under the same invariants", () => {
    const entry = unwrap(TimeEntry.create(offProps()));
    const good = entry.patch({ minutes: 240 }, now);
    expect(isOk(good)).toBe(true);
    const bad = entry.patch({ minutes: 0 }, now);
    expect(bad.ok).toBe(false);
  });
});

describe("TimeEntry — the hand-edit trail", () => {
  const now = new Date("2026-07-08T12:00:00Z");
  it("records who edited via patch's editedBy", () => {
    const entry = unwrap(TimeEntry.create(baseProps()));
    const edited = entry.patch(
      { note: "corrected" },
      now,
      asUserId("44444444-4444-4444-4444-444444444444"),
    );
    expect(isOk(edited)).toBe(true);
    if (isOk(edited)) {
      expect(edited.value.props.editedByUserId).toBe("44444444-4444-4444-4444-444444444444");
    }
  });

  it("leaves the trail untouched when no editor is given (system writes)", () => {
    const entry = unwrap(TimeEntry.create(baseProps()));
    const patched = entry.patch({ note: "clock write" }, now);
    expect(isOk(patched)).toBe(true);
    if (isOk(patched)) expect(patched.value.props.editedByUserId).toBeNull();
  });
});
