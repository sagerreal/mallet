/**
 * modules/timesheets/domain/overlap.test.ts
 *
 * One person cannot be two places at once. The day clock writes strictly sequential segments —
 * a break is its own row BESIDE a worked one, never inside it — so any two rows for the same
 * tech that share a moment are an error, and letting one through double-counts the day
 * (the 12.02 h Tuesday: Shop 10:00–22:00 plus Shop 10:37–10:38, both summed).
 */
import { describe, it, expect } from "vitest";
import { findOverlap, type OverlapWindow } from "./overlap";

const row = (over: Partial<OverlapWindow> = {}): OverlapWindow => ({
  id: "existing-1",
  kind: "shop",
  startTime: "10:00",
  endTime: "22:00",
  running: false,
  ...over,
});

describe("findOverlap", () => {
  it("names the row a contained interval collides with — the 12.02h shape", () => {
    const clash = findOverlap({ startTime: "10:37", endTime: "10:38", running: false }, [row()]);
    expect(clash?.id).toBe("existing-1");
  });

  it("catches a partial overlap hanging off the end", () => {
    const clash = findOverlap({ startTime: "21:00", endTime: "23:00", running: false }, [row()]);
    expect(clash?.id).toBe("existing-1");
  });

  it("allows rows that touch — one ends exactly when the next starts", () => {
    expect(findOverlap({ startTime: "22:00", endTime: "23:00", running: false }, [row()])).toBeNull();
    expect(findOverlap({ startTime: "09:00", endTime: "10:00", running: false }, [row()])).toBeNull();
  });

  it("allows a row clear of everything", () => {
    expect(findOverlap({ startTime: "07:00", endTime: "09:30", running: false }, [row()])).toBeNull();
  });

  it("treats a RUNNING row as open-ended — the clock will close over any later row", () => {
    const open = row({ id: "open-1", startTime: "13:00", endTime: null, running: true });
    expect(findOverlap({ startTime: "14:00", endTime: "15:00", running: false }, [open])?.id).toBe("open-1");
    // Entirely before the open segment started: fine.
    expect(findOverlap({ startTime: "08:00", endTime: "09:00", running: false }, [open])).toBeNull();
  });

  it("treats a running CANDIDATE as open-ended too", () => {
    const later = row({ id: "later-1", startTime: "18:00", endTime: "19:00" });
    expect(findOverlap({ startTime: "13:00", endTime: null, running: true }, [later])?.id).toBe("later-1");
  });

  it("never clashes a row with itself — the update case", () => {
    expect(
      findOverlap({ id: "existing-1", startTime: "10:00", endTime: "22:00", running: false }, [row()]),
    ).toBeNull();
  });

  it("returns the earliest-starting clash when several collide, so the message is stable", () => {
    const clash = findOverlap({ startTime: "09:00", endTime: "23:00", running: false }, [
      row({ id: "b", startTime: "12:00", endTime: "13:00" }),
      row({ id: "a", startTime: "10:00", endTime: "11:00" }),
    ]);
    expect(clash?.id).toBe("a");
  });

  it("skips rows whose times will not parse rather than guessing", () => {
    const bad = row({ id: "bad", startTime: "garbage" });
    expect(findOverlap({ startTime: "10:00", endTime: "11:00", running: false }, [bad])).toBeNull();
  });
});
