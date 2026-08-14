import { describe, it, expect } from "vitest";
import { toDayTotals, toDayTimeActivity, dayKey } from "./day-total-mapping";
import type { SyncableTimeEntry } from "./time-activity-mapping";

const TECH = "t1";
const e = (over: Partial<SyncableTimeEntry> = {}): SyncableTimeEntry => ({
  id: "e1",
  techUserId: TECH,
  workDate: "2026-08-11",
  kind: "shop",
  startTime: "08:00",
  endTime: "16:00",
  note: "",
  ...over,
});
const PERSON = { qboId: "42", kind: "Employee" as const };

describe("toDayTotals", () => {
  it("sums a day's entries into ONE total", () => {
    const r = toDayTotals([e({ id: "a", endTime: "12:00" }), e({ id: "b", startTime: "13:00", endTime: "16:00" })]);
    expect(r.ok && r.value).toHaveLength(1);
    expect(r.ok && r.value[0]?.minutes).toBe(4 * 60 + 3 * 60);
    expect(r.ok && r.value[0]?.entryIds).toEqual(["a", "b"]);
  });

  it("counts JOB time in the total — it is paid", () => {
    // The decision is that QuickBooks gets hours, not what they were spent on. Leaving job time
    // out would short the paycheque by exactly the hours somebody actually worked.
    const r = toDayTotals([e({ kind: "job", endTime: "12:00" })]);
    expect(r.ok && r.value[0]?.minutes).toBe(4 * 60);
  });

  it("leaves BREAKS out — unpaid is not hours worked", () => {
    const r = toDayTotals([e({ endTime: "12:00" }), e({ id: "b", kind: "break", startTime: "12:00", endTime: "12:30" })]);
    expect(r.ok && r.value[0]?.minutes).toBe(4 * 60);
    expect(r.ok && r.value[0]?.entryIds).toEqual(["e1"]);
  });

  it("splits distinct days", () => {
    const r = toDayTotals([e(), e({ id: "b", workDate: "2026-08-12" })]);
    expect(r.ok && r.value).toHaveLength(2);
  });

  it("returns days in date order", () => {
    const r = toDayTotals([e({ workDate: "2026-08-13" }), e({ id: "b", workDate: "2026-08-11" })]);
    expect(r.ok && r.value.map((d) => d.workDate)).toEqual(["2026-08-11", "2026-08-13"]);
  });

  it("REFUSES the whole day when one entry is still running", () => {
    // A day short by one entry is a short paycheque that looks correct.
    const r = toDayTotals([e(), e({ id: "b", endTime: null })]);
    expect(r.ok).toBe(false);
  });

  it("refuses a zero-length entry rather than adding nothing", () => {
    expect(toDayTotals([e({ endTime: "08:00" })]).ok).toBe(false);
  });

  it("refuses an unreadable time", () => {
    expect(toDayTotals([e({ startTime: "nonsense" })]).ok).toBe(false);
  });

  it("is not upset by a malformed BREAK — it was never going to contribute", () => {
    const r = toDayTotals([e({ endTime: "12:00" }), e({ id: "b", kind: "break", endTime: null })]);
    expect(r.ok && r.value[0]?.minutes).toBe(4 * 60);
  });

  it("gives an empty week no days", () => {
    const r = toDayTotals([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });
});

describe("toDayTimeActivity", () => {
  const day = { techUserId: TECH, workDate: "2026-08-11", minutes: 7 * 60 + 30, entryIds: ["a"] };

  it("carries the day's hours and minutes", () => {
    const r = toDayTimeActivity(day, PERSON, "item-1");
    expect(r.ok && r.value.hours).toBe(7);
    expect(r.ok && r.value.minutes).toBe(30);
    expect(r.ok && r.value.txnDate).toBe("2026-08-11");
  });

  it("is NEVER billable — a day total is not one customer's work", () => {
    const r = toDayTimeActivity(day, PERSON, "item-1");
    expect(r.ok && r.value.billable).toBe(false);
  });

  it("carries no job name in the description", () => {
    const r = toDayTimeActivity(day, PERSON, "item-1");
    expect(r.ok && r.value.description).toBe("Hours worked");
  });

  it("refuses when the person is not matched to QuickBooks", () => {
    expect(toDayTimeActivity(day, null, "item-1").ok).toBe(false);
  });

  it("refuses when no service item is chosen", () => {
    expect(toDayTimeActivity(day, PERSON, null).ok).toBe(false);
  });

  it("refuses a day totalling nothing", () => {
    expect(toDayTimeActivity({ ...day, minutes: 0 }, PERSON, "item-1").ok).toBe(false);
  });
});

describe("dayKey", () => {
  it("keys a day, not an entry — the unit being pushed", () => {
    expect(dayKey("t1", "2026-08-11")).toBe("t1:2026-08-11");
  });

  it("differs per person and per day, so one push cannot suppress another", () => {
    // This key is the only thing between an at-least-once outbox and paying somebody twice.
    const keys = new Set([dayKey("t1", "2026-08-11"), dayKey("t2", "2026-08-11"), dayKey("t1", "2026-08-12")]);
    expect(keys.size).toBe(3);
  });
});
