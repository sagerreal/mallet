import { describe, it, expect } from "vitest";
import {
  toTimeActivity,
  UNMAPPED_EMPLOYEE,
  NO_DEFAULT_ITEM,
  NOT_FINISHED,
  ZERO_DURATION,
  BREAK_NOT_PAID,
  type SyncableTimeEntry,
  type PersonLink,
} from "./time-activity-mapping";

const ITEM = "42";
const PERSON: PersonLink = { qboId: "77", kind: "Employee" };

const entry = (over: Partial<SyncableTimeEntry> = {}): SyncableTimeEntry => ({
  id: "te-1",
  techUserId: "user-1",
  workDate: "2026-07-21",
  kind: "job",
  startTime: "08:00",
  endTime: "16:30",
  note: "Water heater swap",
  ...over,
});

const mapped = (over: Partial<SyncableTimeEntry> = {}, person: PersonLink | null = PERSON) => {
  const res = toTimeActivity(entry(over), person, ITEM);
  if (!res.ok) throw new Error(`expected ok, got ${res.error.message}`);
  return res.value;
};

describe("duration", () => {
  it("sends hours and minutes, not clock times (naive local times would shift the day)", () => {
    const a = mapped();
    expect(a.hours).toBe(8);
    expect(a.minutes).toBe(30);
    expect(a).not.toHaveProperty("startTime");
    expect(a).not.toHaveProperty("StartTime");
  });

  it.each([
    ["08:00", "16:00", 8, 0],
    ["08:00", "08:45", 0, 45],
    ["07:15", "16:05", 8, 50],
    ["00:00", "23:59", 23, 59],
  ])("%s → %s is %ih %im", (startTime, endTime, h, m) => {
    const a = mapped({ startTime, endTime });
    expect([a.hours, a.minutes]).toEqual([h, m]);
  });

  it("rejects a zero-length entry", () => {
    const res = toTimeActivity(entry({ startTime: "09:00", endTime: "09:00" }), PERSON, ITEM);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe(ZERO_DURATION);
  });

  it("rejects a still-running timer rather than guessing an end", () => {
    const res = toTimeActivity(entry({ endTime: null }), PERSON, ITEM);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe(NOT_FINISHED);
  });
});

describe("what is deliberately NOT sent", () => {
  it("sends no pay rate — QuickBooks owns the wage", () => {
    const a = mapped() as unknown as Record<string, unknown>;
    expect(a.hourlyRate).toBeUndefined();
    expect(a.costRate).toBeUndefined();
    expect(a.payrollItemId).toBeUndefined();
  });

  it("never sends break time — unpaid breaks would inflate pay", () => {
    const res = toTimeActivity(entry({ kind: "break" }), PERSON, ITEM);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe(BREAK_NOT_PAID);
  });

  it("does not split overtime — QBO Payroll derives it, so a pre-split would double-count", () => {
    // A 12h day maps to 12h, not 8 + 4.
    const a = mapped({ startTime: "06:00", endTime: "18:00" });
    expect(a.hours).toBe(12);
  });
});

describe("billability follows the kind of work", () => {
  it("job time is billable", () => {
    expect(mapped({ kind: "job" }).billable).toBe(true);
  });

  it.each(["travel", "shop"] as const)("%s time is worked but not billable", (kind) => {
    expect(mapped({ kind }).billable).toBe(false);
  });
});

describe("preconditions a shop can fix", () => {
  it("refuses an unmapped person with a code the UI can act on", () => {
    const res = toTimeActivity(entry(), null, ITEM);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe(UNMAPPED_EMPLOYEE);
  });

  it("refuses when no service item is chosen (QBO requires ItemRef)", () => {
    const res = toTimeActivity(entry(), PERSON, null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.field).toBe(NO_DEFAULT_ITEM);
  });

  it("reports the break rule before the mapping problem — a break is never syncable either way", () => {
    const res = toTimeActivity(entry({ kind: "break" }), null, null);
    if (!res.ok) expect(res.error.field).toBe(BREAK_NOT_PAID);
  });
});

describe("routing and description", () => {
  it("uses EmployeeRef semantics for an employee", () => {
    expect(mapped().personKind).toBe("Employee");
  });

  it("uses VendorRef semantics for a 1099 sub", () => {
    expect(mapped({}, { qboId: "88", kind: "Vendor" }).personKind).toBe("Vendor");
  });

  it("carries the note across", () => {
    expect(mapped().description).toBe("Water heater swap");
  });

  it("falls back to the kind so the QuickBooks row is never blank", () => {
    expect(mapped({ note: "   " }).description).toBe("job");
  });

  it("passes the work date through as the transaction date", () => {
    expect(mapped().txnDate).toBe("2026-07-21");
  });

  it("uses the chosen service item", () => {
    expect(mapped().itemId).toBe(ITEM);
  });
});
