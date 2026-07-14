import { describe, it, expect } from "vitest";
import {
  computeSlots,
  MAX_SLOTS,
  WINDOW_BOUNDARY_HOUR,
  type OrgHours,
  type BookedVisit,
  type ComputeSlotsInput,
} from "./slots";

// Standard trade-shop hours: weekdays 8–17, Saturday 8–12 (morning only), Sunday closed (0/0).
const HOURS: OrgHours = {
  wdOpen: 8,
  wdClose: 17,
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

const bookedMorning = (date: string): BookedVisit => ({ date, startHHMM: "09:00", durationMinutes: 60 });
const bookedAfternoon = (date: string): BookedVisit => ({ date, startHHMM: "14:00", durationMinutes: 60 });

describe("computeSlots — window shape", () => {
  it("offers today's morning then afternoon when the day is wide open", () => {
    const slots = computeSlots(base());
    expect(slots).toHaveLength(MAX_SLOTS);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "morning", startHHMM: "08:00" });
    expect(slots[1]).toMatchObject({ date: "2026-07-14", window: "afternoon", startHHMM: "13:00" });
  });

  it("speaks today's morning without the window word, afternoon with it", () => {
    const slots = computeSlots(base());
    expect(slots[0]!.speakable).toBe("today 8 to 12");
    expect(slots[1]!.speakable).toBe("today afternoon, 1 to 5");
  });

  it("speaks tomorrow with 'tomorrow' and named weekdays by name", () => {
    // Only the afternoon is free today → next slot rolls to tomorrow (Wednesday) morning.
    const slots = computeSlots(base({ visits: [bookedMorning("2026-07-14")] }));
    expect(slots[0]!.speakable).toBe("today afternoon, 1 to 5");
    expect(slots[1]!.speakable).toBe("tomorrow 8 to 12");
  });

  it("names a weekday when the slot is 2+ days out", () => {
    // Fully book Tue + Wed so the earliest free windows land on Thursday.
    const visits: BookedVisit[] = [
      bookedMorning("2026-07-14"),
      bookedAfternoon("2026-07-14"),
      bookedMorning("2026-07-15"),
      bookedAfternoon("2026-07-15"),
    ];
    const slots = computeSlots(base({ visits }));
    expect(slots[0]!.speakable).toBe("Thursday morning, 8 to 12");
    expect(slots[1]!.speakable).toBe("Thursday afternoon, 1 to 5");
  });
});

describe("computeSlots — closed days", () => {
  it("skips a closed Sunday entirely", () => {
    // now = Saturday 2026-07-18 13:00 (afternoon already past open for Sat which closes at 12).
    // Saturday is morning-only (8–12); Sunday is closed; Monday reopens.
    const satAfternoon = new Date(2026, 6, 18, 13, 0, 0);
    const slots = computeSlots(base({ now: satAfternoon }));
    // Sat afternoon window doesn't exist (closes 12) and it's past; Sunday closed → Monday morning first.
    expect(slots.every((s) => s.date !== "2026-07-19")).toBe(true); // no Sunday slot
    expect(slots[0]).toMatchObject({ date: "2026-07-20", window: "morning" });
  });

  it("returns nothing when every day in the lookahead is closed", () => {
    const closed: OrgHours = { wdOpen: 0, wdClose: 0, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 };
    const slots = computeSlots(base({ hours: closed }));
    expect(slots).toEqual([]);
  });

  it("offers only the morning on a Saturday (close at boundary, no afternoon)", () => {
    // now = Saturday 07:00; Sat hours 8–12 → morning only, no afternoon (close === boundary − 1).
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(base({ now: sat0700 }));
    expect(slots[0]).toMatchObject({ date: "2026-07-18", window: "morning", startHHMM: "08:00" });
    // Next slot is NOT Saturday afternoon (doesn't exist) and NOT Sunday (closed) → Monday morning.
    expect(slots[1]).toMatchObject({ date: "2026-07-20", window: "morning" });
  });
});

describe("computeSlots — capacity vs crew", () => {
  it("drops a fully-booked morning and offers the afternoon", () => {
    const slots = computeSlots(base({ visits: [bookedMorning("2026-07-14")], crewCount: 1 }));
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "afternoon" });
  });

  it("keeps a window open while overlapping visits are below crew size", () => {
    // crewCount 2, one morning visit → morning still has capacity (1 < 2).
    const slots = computeSlots(base({ visits: [bookedMorning("2026-07-14")], crewCount: 2 }));
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "morning" });
  });

  it("closes a window once overlapping visits reach crew size", () => {
    // crewCount 2, two morning visits → morning full; afternoon is next.
    const visits = [bookedMorning("2026-07-14"), { date: "2026-07-14", startHHMM: "10:00", durationMinutes: 60 }];
    const slots = computeSlots(base({ visits, crewCount: 2 }));
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "afternoon" });
  });

  it("treats a null-start visit as occupying the morning window", () => {
    const nullVisit: BookedVisit = { date: "2026-07-14", startHHMM: null, durationMinutes: 60 };
    const slots = computeSlots(base({ visits: [nullVisit], crewCount: 1 }));
    // Morning is consumed by the null-start visit → first offer is the afternoon.
    expect(slots[0]).toMatchObject({ date: "2026-07-14", window: "afternoon" });
  });
});

describe("computeSlots — emergency", () => {
  it("offers today even when it's already past open on a normal call the same time would skip", () => {
    // now = Tuesday 15:00 — past the morning window's open (8) and into the afternoon (13–17).
    const tue1500 = new Date(2026, 6, 14, 15, 0, 0);
    const normal = computeSlots(base({ now: tue1500, emergency: false }));
    // Normal: morning is in the past (open 8 < nowHour 15) → first offer is today afternoon.
    expect(normal[0]).toMatchObject({ date: "2026-07-14", window: "afternoon" });

    // Emergency: still today afternoon first, but the morning would also be surfaced if it existed.
    const emergency = computeSlots(base({ now: tue1500, emergency: true }));
    expect(emergency[0]).toMatchObject({ date: "2026-07-14", window: "morning" });
    expect(emergency).toHaveLength(MAX_SLOTS);
  });

  it("surfaces today's window on an emergency even when the day has fully closed", () => {
    // now = Tuesday 18:00 — past the 17:00 close. A normal call has no window left today and rolls
    // to tomorrow; an emergency still surfaces today's soonest possible window (the office triages).
    const tue1800 = new Date(2026, 6, 14, 18, 0, 0);
    const normal = computeSlots(base({ now: tue1800, emergency: false }));
    expect(normal[0]!.date).toBe("2026-07-15"); // rolled to tomorrow

    const emergency = computeSlots(base({ now: tue1800, emergency: true }));
    expect(emergency[0]!.date).toBe("2026-07-14"); // today still offered
  });
});

describe("computeSlots — lookahead exhaustion", () => {
  it("returns fewer than MAX_SLOTS when the lookahead runs out", () => {
    // lookahead 0 = today only; Sat morning-only + book it → zero.
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(
      base({ now: sat0700, lookaheadDays: 0, visits: [bookedMorning("2026-07-18")] }),
    );
    expect(slots).toEqual([]);
  });

  it("returns exactly one slot when only one window remains in the lookahead", () => {
    // lookahead 0, today (Tue) wide open, morning booked → only the afternoon remains.
    const slots = computeSlots(base({ lookaheadDays: 0, visits: [bookedMorning("2026-07-14")] }));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ window: "afternoon" });
  });
});

describe("computeSlots — invariants", () => {
  it("never returns more than MAX_SLOTS", () => {
    const slots = computeSlots(base({ lookaheadDays: 30 }));
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
  });

  it("uses 13:00 as the window boundary", () => {
    expect(WINDOW_BOUNDARY_HOUR).toBe(13);
    const slots = computeSlots(base());
    expect(slots[1]!.startHHMM).toBe("13:00");
  });
});
