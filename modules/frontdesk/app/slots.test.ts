import { describe, it, expect } from "vitest";
import {
  computeSlots,
  windowEndHHMM,
  MAX_SLOTS,
  SLOT_WINDOW_HOURS,
  type OrgHours,
  type BookedVisit,
  type ComputeSlotsInput,
  type CrewSchedule,
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

// A crew that works the org's default hours every day (no overrides).
const ORG_HOURS_CREW: CrewSchedule = { overrides: [] };

const base = (over: Partial<ComputeSlotsInput> = {}): ComputeSlotsInput => ({
  now: TUE_0700,
  hours: HOURS,
  visits: [],
  crews: [ORG_HOURS_CREW],
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

describe("computeSlots — 2-hour window shape (endHHMM kept internally)", () => {
  it("keeps startHHMM + endHHMM = start + SLOT_WINDOW_HOURS on every offered slot", () => {
    const slots = computeSlots(base());
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(windowEndHHMM(s.startHHMM)).toBe(s.endHHMM);
    }
  });

  it("offers exactly the day's windows when only one day is in range (no spread needed)", () => {
    // lookahead 0 = today only; Sat morning-only shop → 8-10, 10-12 (2 windows, ≤ MAX_SLOTS → all).
    const sat0700 = new Date(2026, 6, 18, 7, 0, 0);
    const slots = computeSlots(base({ now: sat0700, lookaheadDays: 0 }));
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: "2026-07-18", startHHMM: "08:00", endHHMM: "10:00" });
    expect(slots[1]).toMatchObject({ date: "2026-07-18", startHHMM: "10:00", endHHMM: "12:00" });
  });
});

describe("computeSlots — discrete start-time speakable", () => {
  it("speaks a discrete START TIME (not a range), day-prefixed", () => {
    // Single day, exactly 3 windows so the spread offers all three, earliest-first.
    const oddHours: OrgHours = { ...HOURS, wdOpen: 8, wdClose: 14 }; // 8-10, 10-12, 12-14
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    expect(slots).toHaveLength(3);
    expect(slots[0]!.speakable).toBe("today at 8am");
    expect(slots[1]!.speakable).toBe("today at 10am");
    // noon is worded, not "12pm"
    expect(slots[2]!.speakable).toBe("today at noon");
  });

  it("words an afternoon start with pm", () => {
    // Fill today's earlier windows so the first offer is 14:00 → "today at 2pm". Single day.
    const oddHours: OrgHours = { ...HOURS, wdOpen: 8, wdClose: 16 }; // 8,10,12,14
    const visits: BookedVisit[] = [
      bookedAt("2026-07-14", "08:00"),
      bookedAt("2026-07-14", "10:00"),
      bookedAt("2026-07-14", "12:00"),
    ];
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0, visits }));
    expect(slots).toHaveLength(1);
    expect(slots[0]!.speakable).toBe("today at 2pm");
  });

  it("speaks 'tomorrow' and named weekdays by name", () => {
    // now = Monday 2026-07-13 07:00. Book Monday full + Tuesday's first four so Tue's only open
    // window is 16:00, then Wednesday opens fresh. Restrict lookahead to 2 so the candidate set is
    // small and the spread offers all of them (Tue 4pm, Wed 8am, Wed 10am → but ≤3 across days).
    const mon0700 = new Date(2026, 6, 13, 7, 0, 0);
    const oddHours: OrgHours = { ...HOURS, wdClose: 18 };
    const visits: BookedVisit[] = [
      // Monday 07-13: fill all five windows
      bookedAt("2026-07-13", "08:00"),
      bookedAt("2026-07-13", "10:00"),
      bookedAt("2026-07-13", "12:00"),
      bookedAt("2026-07-13", "14:00"),
      bookedAt("2026-07-13", "16:00"),
      // Tuesday 07-14: fill four so only 16–18 remains → "tomorrow at 4pm"
      bookedAt("2026-07-14", "08:00"),
      bookedAt("2026-07-14", "10:00"),
      bookedAt("2026-07-14", "12:00"),
      bookedAt("2026-07-14", "14:00"),
      // Wednesday 07-15: fill all but the first so Wed contributes exactly 08:00
      bookedAt("2026-07-15", "10:00"),
      bookedAt("2026-07-15", "12:00"),
      bookedAt("2026-07-15", "14:00"),
      bookedAt("2026-07-15", "16:00"),
    ];
    const slots = computeSlots(base({ now: mon0700, hours: oddHours, lookaheadDays: 2, visits }));
    // Two available windows: Tue 16:00, Wed 08:00 → ≤ MAX_SLOTS so both offered, earliest-first.
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "16:00" });
    expect(slots[0]!.speakable).toBe("tomorrow at 4pm");
    expect(slots[1]).toMatchObject({ date: "2026-07-15", startHHMM: "08:00" });
    expect(slots[1]!.speakable).toBe("Wednesday at 8am");
  });
});

describe("computeSlots — spread selection (discrete times across the day)", () => {
  it("offers first / middle / last when more than MAX_SLOTS windows are available", () => {
    // Single day, 8–18 → five windows: 8,10,12,14,16. Spread of 3 → indices 0,2,4 → 8, noon, 4pm.
    const slots = computeSlots(base({ lookaheadDays: 0 }));
    expect(slots).toHaveLength(MAX_SLOTS);
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "12:00", "16:00"]);
    expect(slots.map((s) => s.speakable)).toEqual([
      "today at 8am",
      "today at noon",
      "today at 4pm",
    ]);
  });

  it("offers ALL windows (no sampling) when exactly MAX_SLOTS are available", () => {
    // 8–14 → exactly three windows: 8,10,12 → all offered, earliest-first (no dropping).
    const oddHours: OrgHours = { ...HOURS, wdClose: 14 };
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "10:00", "12:00"]);
  });

  it("offers all when fewer than MAX_SLOTS are available", () => {
    // 8–12 → two windows → both offered.
    const oddHours: OrgHours = { ...HOURS, wdClose: 12 };
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "10:00"]);
  });

  it("spreads first / middle / last across an even count of windows (endpoints kept)", () => {
    // 8–16 → four windows: 8,10,12,14. Spread of 3 over indices 0..3 → round(0), round(1.5)=2,
    // round(3) → 0,2,3 → 8, 12, 14 (first, a middle-ish, last — always keeps first + last).
    const oddHours: OrgHours = { ...HOURS, wdClose: 16 };
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "12:00", "14:00"]);
  });

  it("always keeps the earliest available window first (soonest-first preserved)", () => {
    const slots = computeSlots(base({ lookaheadDays: 5 }));
    // With a 5-day lookahead there are many windows; the very first offer is always the soonest.
    expect(slots[0]).toMatchObject({ date: "2026-07-14", startHHMM: "08:00" });
  });
});

describe("computeSlots — today's past windows", () => {
  it("skips windows whose start hour is at/behind the current hour", () => {
    // now = Tuesday 11:00, lookahead 0 → 08–10 and 10–12 are past (start 8,10 <= 11); remaining
    // today windows are 12,14,16 → all three offered (exactly MAX_SLOTS).
    const tue1100 = new Date(2026, 6, 14, 11, 0, 0);
    const slots = computeSlots(base({ now: tue1100, lookaheadDays: 0 }));
    expect(slots[0]).toMatchObject({ startHHMM: "12:00", endHHMM: "14:00" });
    expect(slots.every((s) => s.startHHMM >= "12:00")).toBe(true);
  });
});

describe("computeSlots — closed days", () => {
  it("skips a closed Sunday entirely", () => {
    // now = Saturday 2026-07-18 13:00. Saturday is 8–12 (both windows past by 13:00); Sunday closed;
    // Monday reopens → the earliest offer is Monday 08:00.
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

  it("does not emit a truncated window when hours don't divide evenly (8–13 → 8-10, 10-12)", () => {
    const oddHours: OrgHours = { ...HOURS, wdOpen: 8, wdClose: 13 };
    const slots = computeSlots(base({ hours: oddHours, lookaheadDays: 0 }));
    // 8-10, 10-12 fit; 12-14 would run past 13 close → dropped. No 12–13 stub.
    expect(slots.map((s) => s.startHHMM)).toEqual(["08:00", "10:00"]);
    expect(slots.every((s) => s.endHHMM <= "13:00")).toBe(true);
  });
});

describe("computeSlots — capacity vs crew", () => {
  it("drops a fully-booked window and offers the next", () => {
    // one crew on org hours, one visit at 08:00, lookahead 0 → 8–10 full; remaining today 10,12,14,16 → spread.
    const slots = computeSlots(
      base({ visits: [bookedAt("2026-07-14", "08:00")], crews: [ORG_HOURS_CREW], lookaheadDays: 0 }),
    );
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
    expect(slots.every((s) => s.startHHMM !== "08:00")).toBe(true);
  });

  it("keeps a window open while overlapping visits are below crew size", () => {
    // two crews on org hours, one 08:00 visit → 8–10 still has capacity (1 < 2), so it's the earliest.
    const slots = computeSlots(
      base({ visits: [bookedAt("2026-07-14", "08:00")], crews: [ORG_HOURS_CREW, ORG_HOURS_CREW], lookaheadDays: 0 }),
    );
    expect(slots[0]).toMatchObject({ startHHMM: "08:00" });
  });

  it("closes a window once overlapping visits reach crew size", () => {
    // two crews on org hours, two visits inside 8–10 → full; earliest offer is 10–12.
    const visits = [bookedAt("2026-07-14", "08:00"), bookedAt("2026-07-14", "09:00")];
    const slots = computeSlots(base({ visits, crews: [ORG_HOURS_CREW, ORG_HOURS_CREW], lookaheadDays: 0 }));
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });

  it("treats a null-start visit as occupying the day's first window", () => {
    const nullVisit: BookedVisit = { date: "2026-07-14", startHHMM: null, durationMinutes: 60 };
    const slots = computeSlots(base({ visits: [nullVisit], crews: [ORG_HOURS_CREW], lookaheadDays: 0 }));
    // First window (8–10) consumed by the null-start visit → earliest offer is 10–12.
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });
});

describe("computeSlots — emergency", () => {
  it("surfaces today's soonest window on an emergency even when it's the current window", () => {
    // now = Tuesday 09:00 — inside the 8–10 window, lookahead 0. Normal drops 8–10 (start 8 <= 9);
    // emergency still surfaces it (the office triages the soonest possible time), and because the
    // collection is earliest-first the soonest is always the FIRST offer.
    const tue0900 = new Date(2026, 6, 14, 9, 0, 0);
    const normal = computeSlots(base({ now: tue0900, emergency: false, lookaheadDays: 0 }));
    expect(normal[0]).toMatchObject({ startHHMM: "10:00" }); // 8–10 skipped as past

    const emergency = computeSlots(base({ now: tue0900, emergency: true, lookaheadDays: 0 }));
    expect(emergency[0]).toMatchObject({ startHHMM: "08:00" }); // soonest window surfaced first
  });

  it("surfaces today's window on an emergency even when the day has fully closed", () => {
    // now = Tuesday 19:00 — past the 18:00 close. Normal rolls to tomorrow; emergency still offers
    // today's soonest window as the first offer.
    const tue1900 = new Date(2026, 6, 14, 19, 0, 0);
    const normal = computeSlots(base({ now: tue1900, emergency: false }));
    expect(normal[0]!.date).toBe("2026-07-15"); // rolled to tomorrow

    const emergency = computeSlots(base({ now: tue1900, emergency: true }));
    expect(emergency[0]!.date).toBe("2026-07-14"); // today still offered first
    expect(emergency[0]).toMatchObject({ startHHMM: "08:00" });
  });
});

describe("computeSlots — lookahead exhaustion", () => {
  it("returns nothing when the lookahead runs out", () => {
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

  it("offered start times are distinct (spread never repeats a window)", () => {
    const slots = computeSlots(base({ lookaheadDays: 5 }));
    const keys = slots.map((s) => `${s.date} ${s.startHHMM}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── Crew-aware cases (new in Task 2.2a) ──────────────────────────────────────────

describe("computeSlots — crew-aware capacity", () => {
  it("a window only SOME crews work is offered while any crew is free", () => {
    // crew A has a Tuesday override 8–12 (windows 8-10, 10-12 only)
    // crew B has a Tuesday override 12–18 (windows 12-14, 14-16, 16-18 only)
    // 2026-07-14 is a Tuesday (weekday = 2). No bookings → both crews' windows offered.
    // 8-10 is offered because crew A works it; 12-14 is offered because crew B works it.
    const crewA: CrewSchedule = { overrides: [{ weekday: 2, openHour: 8, closeHour: 12 }] };
    const crewB: CrewSchedule = { overrides: [{ weekday: 2, openHour: 12, closeHour: 18 }] };
    const slots = computeSlots(base({ crews: [crewA, crewB], lookaheadDays: 0 }));
    const starts = slots.map((s) => s.startHHMM);
    // Windows that exist for at least one crew should be offerable when no visits fill them.
    // With spread applied (≤3 of the 5 windows across both crews: 8,10,12,14,16):
    // indices 0,2,4 → 08:00, 12:00, 16:00
    expect(starts).toContain("08:00"); // crew A works it
    expect(starts).toContain("16:00"); // crew B works it
    // spread picks index 0, 2, 4 of [8,10,12,14,16] → 08, 12, 16
    expect(slots).toHaveLength(3);
  });

  it("a window fully booked for ALL working crews is dropped", () => {
    // Only crew A works 8–10 (override weekday=2, 8–12). One visit at 08:00 fills the sole crew.
    // The 8–10 window should be dropped (1 working crew, 1 occupying visit → no capacity).
    const crewA: CrewSchedule = { overrides: [{ weekday: 2, openHour: 8, closeHour: 12 }] };
    const slots = computeSlots(
      base({
        crews: [crewA],
        visits: [bookedAt("2026-07-14", "08:00")],
        lookaheadDays: 0,
      }),
    );
    expect(slots.every((s) => s.startHHMM !== "08:00")).toBe(true);
    // 10–12 still available (crewA works it, no visit there)
    expect(slots[0]).toMatchObject({ startHHMM: "10:00" });
  });

  it("a window with two working crews stays open when only one is occupied", () => {
    // Two crews both work 8–10 (both have Tuesday override 8–12).
    // One visit at 08:00 occupies one crew's slot → 1 occupying < 2 working → still offered.
    const crewA: CrewSchedule = { overrides: [{ weekday: 2, openHour: 8, closeHour: 12 }] };
    const crewB: CrewSchedule = { overrides: [{ weekday: 2, openHour: 8, closeHour: 12 }] };
    const slots = computeSlots(
      base({
        crews: [crewA, crewB],
        visits: [bookedAt("2026-07-14", "08:00")],
        lookaheadDays: 0,
      }),
    );
    expect(slots[0]).toMatchObject({ startHHMM: "08:00" });
  });

  it("per-weekday override applies to its day only; absent weekday falls back to org hours", () => {
    // Crew has a Monday override (weekday=1) with 10–14. Tuesday (weekday=2) has no override
    // → falls back to org hours (8–18 → 8,10,12,14,16).
    // 2026-07-14 is Tuesday; 2026-07-13 is Monday.
    const mon0700 = new Date(2026, 6, 13, 7, 0, 0);
    const crew: CrewSchedule = { overrides: [{ weekday: 1, openHour: 10, closeHour: 14 }] };
    // Monday (day 0): override 10–14 → windows 10-12, 12-14
    const monSlots = computeSlots(base({ now: mon0700, crews: [crew], lookaheadDays: 0 }));
    expect(monSlots.map((s) => s.startHHMM)).toEqual(["10:00", "12:00"]);

    // Tuesday (day 1 from Monday): crew has no Tuesday override → org hours 8–18 → 5 windows.
    const tueslots = computeSlots(base({ now: mon0700, crews: [crew], lookaheadDays: 1 }));
    // The Tuesday slots should use org hours (8-18 = 5 windows), so 8am must appear on Tue.
    const tuesdaySlots = tueslots.filter((s) => s.date === "2026-07-14");
    // With spread across both days, Tuesday slots may be sampled, but 08:00 Tue should appear
    // in the full candidate set. Test: override with lookahead=1 on Tuesday-only gives org hours.
    const tueSlotsOnly = computeSlots(base({ crews: [crew], lookaheadDays: 0 }));
    // TUE_0700 is Tuesday — crew has no Tuesday override → org hours → 5 windows → spread to 3
    expect(tueSlotsOnly.map((s) => s.startHHMM)).toEqual(["08:00", "12:00", "16:00"]);
    expect(tuesdaySlots.length).toBeGreaterThan(0);
  });

  it("an inverted or zero-width override (openHour >= closeHour) yields no windows and does not throw", () => {
    // Crew has a bad Tuesday override (12–8 inverted). Should produce NO windows for Tuesday
    // (bad data yields zero windows silently — no throw). The org fallback is NOT applied
    // (the override is present but inverted — treat as "closed that day for this crew").
    const crew: CrewSchedule = { overrides: [{ weekday: 2, openHour: 12, closeHour: 8 }] };
    expect(() => {
      const slots = computeSlots(base({ crews: [crew], lookaheadDays: 0 }));
      // inverted override → crew produces no windows on Tuesday; with MIN_CREW clamping not
      // applied here (crews: [crew] is non-empty), zero available windows → no slots.
      expect(slots).toEqual([]);
    }).not.toThrow();
  });

  it("equal open/close (zero-width) override yields no windows and does not throw", () => {
    // openHour === closeHour (e.g. 8/8) → zero-width → no windows for this crew that day.
    const crew: CrewSchedule = { overrides: [{ weekday: 2, openHour: 8, closeHour: 8 }] };
    expect(() => {
      const slots = computeSlots(base({ crews: [crew], lookaheadDays: 0 }));
      expect(slots).toEqual([]);
    }).not.toThrow();
  });

  it("empty crews: [] behaves identically to a single org-hours crew (MIN_CREW clamp)", () => {
    // Empty crew list → MIN_CREW clamp → treated as one crew on org hours.
    const withEmpty = computeSlots(base({ crews: [], lookaheadDays: 0 }));
    const withOne = computeSlots(base({ crews: [ORG_HOURS_CREW], lookaheadDays: 0 }));
    expect(withEmpty.map((s) => s.startHHMM)).toEqual(withOne.map((s) => s.startHHMM));
    expect(withEmpty.map((s) => s.date)).toEqual(withOne.map((s) => s.date));
  });

  it("null-start visit occupies the earliest working-crew window (first of the day)", () => {
    // With per-crew hours, "first window" = earliest window produced by any working crew.
    // Crew A works 10–14 (override for Tuesday). First window = 10–12.
    // A null-start visit should occupy 10–12. With crewCount 1, that window is closed.
    const crewA: CrewSchedule = { overrides: [{ weekday: 2, openHour: 10, closeHour: 14 }] };
    const nullVisit: BookedVisit = { date: "2026-07-14", startHHMM: null, durationMinutes: 60 };
    const slots = computeSlots(
      base({ crews: [crewA], visits: [nullVisit], lookaheadDays: 0 }),
    );
    // 10–12 consumed by null-start → only 12–14 remains
    expect(slots[0]).toMatchObject({ startHHMM: "12:00" });
    expect(slots.every((s) => s.startHHMM !== "10:00")).toBe(true);
  });
});
