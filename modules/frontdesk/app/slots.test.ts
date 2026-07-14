import { describe, it, expect } from "vitest";
import {
  computeSlots,
  windowEndHHMM,
  MAX_SLOTS,
  SLOT_WINDOW_HOURS,
  type OrgHours,
  type BookedVisit,
  type ComputeSlotsInput,
} from "./slots";

// Standard trade-shop hours: weekdays 8–18 (→ 8-10, 10-12, 12-14, 14-16, 16-18), Saturday 8–12
// (→ 8-10, 10-12), Sunday closed (0/0).
const HOURS: OrgHours = {
  wdOpen: 8,
  wdClose: 18,
  satOpen: 8,
  satClose: 12,
  sunOpen: 0,
  sunClose: 0,
};

// A fixed reference "now". 2026-07-14 is a TUESDAY at 07:00 local — before the day's 8:00 open, so
// today's windows are all still ahead. Anchored so every assertion below is deterministic.
const TUE_0700 = new Date(2026, 6, 14, 7, 0, 0);

const base = (over: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput => ({
  now: TUE_0700,
  hours: HOURS,
  visits: [],
  crewCount: 1,
  lookaheadDays: 5,
  emergency: false,
  ...over,
});

// A visit occupying the given HH:MM window start (1h duration is irrelevant — placement is by start).
const bookedAt = (date: string, startHHMM: string): BookedVisit => ({ date, startHHMM, durationMinutes: 60 });

describe("windowEndHHMM", () => {
  it("adds SLOT_WINDOW_HOURS to a start time", () => {
    expect(SLOT_WINDOW_HOURS).toBe(2);
    expect(windowEndHHMM("08:00")).toBe("10:00");
    expect(windowEndHHMM("14:00")).toBe("16:00");
    expect(windowEndHHMM("12:00")).toBe("14:00");
  });

  it("clamps a late start to end-of-day (never rolls past 24:00)", () => {
    expect(windowEndHHMM("23:00")).toBe("24:00");
  });
});

describe("computeSlots — 2-hour window shape", () => {
  it("steps 8–18 into 2-hour windows, earliest MAX_SLOTS first", () => {
    const slots = computeSlots(base());
    expect(slots).toHaveLength(MAX_SLOTS);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "08:00", endHHMM: "10:00" });
    expect(slots[1]).toMatchObject({ date: "2026-07-14", startHHMM: "10:00", endHHMM: "12:00" });
    expect(slots[2]).toMatchObject({ date: "2026-07-14", startHHMM: "12:00", endHHMM: "14:00" });
  });

  it("speaks natural 12-hour ranges with a single am/pm on the end", () => {
    const slots = computeSlots(base());
    expect(slots[0]!.speakable).toBe("today, 8 to 10am");
    expect(slots[1]!.speakable).toBe("today, 10 to 12pm");
    expect(slots[2]!.speakable).toBe("today, 12 to 2pm");
  });

  it("speaks an afternoon window with a pm range", () => {
    // Fill today's earlier windows so the first offer is 14–16 → "today, 2 to 4pm".
    const visits: BookedVisit[] = [
      bookedAt("2026-07-14", "08:00"),
      bookedAt("2026-07-14", "10:00"),
      bookedAt("2026-07-14", "12:00"),
    ];
    const slots = computeSlots(base({ visits }));
    expect(slots[0]!.speakable).toBe("today, 2 to 4pm");
  });

  it("speaks 'tomorrow' and named weekdays by name", () => {
    // now = Monday 2026-07-13 07:00 → today Monday, tomorrow Tuesday, then Wednesday by name.
    const mon0700 = new Date(2026, 6, 13, 7, 0, 0);
    // Fully book Monday + Tuesday's first windows enough to roll examples across days.
    const visits: BookedVisit[] = [
      // Monday 07-13: fill all five windows
      bookedAt("2026-07-13", "08:00"),
      bookedAt("2026-07-13", "10:00"),
      bookedAt("2026-07-13", "12:00"),
      bookedAt("2026-07-13", "14:00"),
      bookedAt("2026-07-13", "16:00"),
      // Tuesday 07-14: fill four so only 16–18 remains → "tomorrow, 4 to 6pm"
      bookedAt("2026-07-14", "08:00"),
      bookedAt("2026-07-14", "10:00"),
      bookedAt("2026-07-14", "12:00"),
      bookedAt("2026-07-14", "14:00"),
    ];
    const slots = computeSlots(base({ now: mon0700, visits }));
    expect(slots[0]).toMatchObject({ date: "2026-07-14" });
    expect(slots[0]!.speakable).toBe("tomorrow, 4 to 6pm");
    // next windows roll to Wednesday 07-15, named by weekday
    expect(slots[1]).toMatchObject({ date: "2026-07-15" });
    expect(slots[1]!.speakable).toBe("Wednesday, 8 to 10am");
  });
});

describe("computeSlots — today's past windows", () => {
  it("skips windows whose start hour is at/behind the current hour", () => {
    // now = Tuesday 11:00 → 08–10 and 10–12 are past (start 8,10 <= 11); first offer is 12–14.
    const tue1100 = new Date(2026, 6, 14, 11, 0, 0);
    const slots = computeSlots(base({ now: tue1100 }));
    expect(slots[0]).toMatchObject({ startHHMM: "12:00", endHHMM: "14:00" });
    expect(slots.every((s) => s.startHHMM >= "12:00" || s.date !== "2026-07-14")).toBe(true);
  });
});

describe("computeSlots — closed days", () => {
  it("skips a closed Sunday entirely", () => {
    // now = Saturday 2026-07-18 13:00. Saturday is 8–12 (both windows past by 13:00); Sunday closed;
    // Monday reopens.
    const satAfternoon = new Date(2026, 6, 18, 13, 0, 0);
    const slots = computeSlots(base({ now: satAfternoon }));
    expect(slots.every((s) => s.date !== "2026-07-19")).toBe(true); // no Sunday slot
    expect(slots[0]).toMatchObject({ date: "2026-07-20", startHHMM: "08:00" });
  });

  it("returns nothing when every day in the lookahead is closed", () => {
    const closed: OrgHours = { wdOpen: 0, wdClose: 0, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 };
    const slots = computeSlots(base({ hours: closed }));
    expect(slots).toEqual([]);
  });

  it("offers only Saturday's two windows (8–12), never a truncated tail", () => {
    // now = Saturday 07:00; Sat hours 8–12 → exactly 8-10, 10-12.
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(base({ now: sat0700, lookaheadDays: 0 }));
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: "2026-07-18", startHHMM: "08:00", endHHMM: "10:00" });
    expect(slots[1]).toMatchObject({ date: "2026-07-18", startHHMM: "10:00", endHHMM: "12:00" });
  });

  it("does not emit a truncated window when hours don't divide evenly (8–13 → 8-10, 10-12)", () => {
    const oddHours: OrgHours = { ...HOURS, wdOpen: 8, wdClose: 13 };
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    // 8-10, 10-12 fit; 12-14 would run past 13 close → dropped. No 12–13 stub.
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "10:00", "12:00"].slice(0, 2));
    expect(slots.every((s) => s.endHHMM <= "13:00")).toBe(true);
  });
});

describe("computeSlots — capacity vs crew", () => {
  it("drops a fully-booked window and offers the next", () => {
    // crewCount 1, one visit at 08:00 → 8–10 full; first offer is 10–12.
    const slots = computeSlots(base({ visits: [bookedAt("2026-07-14", "08:00")], crewCount: 1 }));
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });

  it("keeps a window open while overlapping visits are below crew size", () => {
    // crewCount 2, one 08:00 visit → 8–10 still has capacity (1 < 2).
    const slots = computeSlots(base({ visits: [bookedAt("2026-07-14", "08:00")], crewCount: 2 }));
    expect(slots[0]).toMatchObject({ startHHMM: "08:00" });
  });

  it("closes a window once overlapping visits reach crew size", () => {
    // crewCount 2, two visits inside 8–10 → full; first offer is 10–12.
    const visits = [bookedAt("2026-07-14", "08:00"), bookedAt("2026-07-14", "09:00")];
    const slots = computeSlots(base({ visits, crewCount: 2 }));
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });

  it("treats a null-start visit as occupying the day's first window", () => {
    const nullVisit: BookedVisit = { date: "2026-07-14", startHHMM: null, durationMinutes: 60 };
    const slots = computeSlots(base({ visits: [nullVisit], crewCount: 1 }));
    // First window (8–10) consumed by the null-start visit → first offer is 10–12.
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });
});

describe("computeSlots — emergency", () => {
  it("surfaces today's soonest window on an emergency even when it's the current window", () => {
    // now = Tuesday 09:00 — inside the 8–10 window. Normal drops 8–10 (start 8 <= 9); emergency
    // still surfaces it (the office triages the soonest possible time).
    const tue0900 = new Date(2026, 6, 14, 9, 0, 0);
    const normal = computeSlots(base({ now: tue0900, emergency: false }));
    expect(normal[0]).toMatchObject({ startHHMM: "10:00" }); // 8–10 skipped as past

    const emergency = computeSlots(base({ now: tue0900, emergency: true }));
    expect(emergency[0]).toMatchObject({ startHHMM: "08:00" }); // soonest window surfaced
    expect(emergency).toHaveLength(MAX_SLOTS);
  });

  it("surfaces today's window on an emergency even when the day has fully closed", () => {
    // now = Tuesday 19:00 — past the 18:00 close. Normal rolls to tomorrow; emergency still offers
    // today's soonest window.
    const tue1900 = new Date(2026, 6, 14, 19, 0, 0);
    const normal = computeSlots(base({ now: tue1900, emergency: false }));
    expect(normal[0]!.date).toBe("2026-07-15"); // rolled to tomorrow

    const emergency = computeSlots(base({ now: tue1900, emergency: true }));
    expect(emergency[0]!.date).toBe("2026-07-14"); // today still offered
    expect(emergency[0]).toMatchObject({ startHHMM: "08:00" });
  });
});

describe("computeSlots — lookahead exhaustion", () => {
  it("returns fewer than MAX_SLOTS when the lookahead runs out", () => {
    // lookahead 0 = today only; Sat morning-only (2 windows) + book both → zero.
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(
      base({
        now: sat0700,
        lookaheadDays: 0,
        visits: [bookedAt("2026-07-18", "08:00"), bookedAt("2026-07-18", "10:00")],
      }),
    );
    expect(slots).toEqual([]);
  });

  it("returns exactly one slot when only one window remains in the lookahead", () => {
    // lookahead 0, Saturday 8–12 (2 windows), first booked → only 10–12 remains.
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(
      base({ now: sat0700, lookaheadDays: 0, visits: [bookedAt("2026-07-18", "08:00")] }),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ startHHMM: "10:00", endHHMM: "12:00" });
  });
});

describe("computeSlots — invariants", () => {
  it("never returns more than MAX_SLOTS", () => {
    const slots = computeSlots(base({ lookaheadDays: 30 }));
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
    expect(MAX_SLOTS).toBe(3);
  });

  it("every offered window is exactly SLOT_WINDOW_HOURS long", () => {
    const slots = computeSlots(base({ lookaheadDays: 5 }));
    for (const s of slots) {
      expect(windowEndHHMM(s.startHHMM)).toBe(s.endHHMM);
    }
  });
});
