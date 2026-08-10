import { describe, it, expect } from "vitest";
import { runsForDay, runLength } from "./my-hours-runs";
import type { MyHoursEntry } from "./my-hours-derive";

const TODAY = "2026-07-01";
const ME = "11111111-1111-1111-1111-111111111111";

let seq = 0;
const entry = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => ({
  id: `e${++seq}`,
  techUserId: ME,
  jobId: null,
  workDate: TODAY,
  kind: "shop",
  startTime: "08:00",
  endTime: "12:00",
  note: "",
  src: "clock",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: "2026-07-01T14:42:00.000Z",
  ...over,
});

describe("runsForDay", () => {
  it("labels a paid stretch Worked and an unpaid one Break — the only split that changes pay", () => {
    const runs = runsForDay([
      entry({ kind: "job", startTime: "08:00", endTime: "12:00" }),
      entry({ kind: "break", startTime: "12:00", endTime: "12:30" }),
    ]);
    expect(runs.map((r) => r.label)).toEqual(["Worked", "Break"]);
  });

  /**
   * THE POINT OF THE WHOLE MODULE. job → shop → job across touching clocks is one unbroken
   * stretch of paid work; the tag changes were transitions, not events the man cares about.
   */
  it("merges touching paid rows across different kinds into one stretch", () => {
    const runs = runsForDay([
      entry({ kind: "job", startTime: "10:46", endTime: "11:16" }),
      entry({ kind: "shop", startTime: "11:16", endTime: "11:22" }),
      entry({ kind: "travel", startTime: "11:22", endTime: "13:51" }),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ label: "Worked", startTime: "10:46", endTime: "13:51" });
    // 10:46 → 13:51 is 3h05m, and the run is worth exactly what its parts were worth.
    expect(runs[0]?.hours).toBeCloseTo(3 + 5 / 60, 6);
    // Nothing is hidden — every row it swallowed is still on the run, still editable.
    expect(runs[0]?.entries).toHaveLength(3);
  });

  it("swallows the one-minute mis-tap sliver instead of rendering it as a 0.02 h row", () => {
    const runs = runsForDay([
      entry({ kind: "job", startTime: "11:22", endTime: "11:23" }),
      entry({ kind: "shop", startTime: "11:23", endTime: "13:51" }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.entries).toHaveLength(2);
  });

  /**
   * A GAP IS REAL — he was off the clock. Merging across it would silently pay him for time he
   * never recorded, which is the one direction a payroll screen must never be wrong in.
   */
  it("never merges across a gap, however small", () => {
    const runs = runsForDay([
      entry({ kind: "shop", startTime: "10:46", endTime: "11:16" }),
      entry({ kind: "shop", startTime: "11:22", endTime: "13:51" }),
    ]);
    expect(runs).toHaveLength(2);
  });

  it("never merges worked time into a break, even when the clocks touch", () => {
    const runs = runsForDay([
      entry({ kind: "job", startTime: "08:00", endTime: "12:00" }),
      entry({ kind: "break", startTime: "12:00", endTime: "12:30" }),
      entry({ kind: "job", startTime: "12:30", endTime: "16:30" }),
    ]);
    expect(runs.map((r) => r.label)).toEqual(["Worked", "Break", "Worked"]);
    expect(runs.map((r) => r.hours)).toEqual([4, 0, 4]);
  });

  it("sorts before merging — the server's intra-day order is by UUID, not by clock", () => {
    const late = entry({ kind: "shop", startTime: "12:00", endTime: "16:00" });
    const early = entry({ kind: "shop", startTime: "08:00", endTime: "12:00" });
    const runs = runsForDay([late, early]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.startTime).toBe("08:00");
  });

  it("ends a run at a row that is still open — nothing can follow a stretch with no end", () => {
    const runs = runsForDay([
      entry({ kind: "shop", startTime: "08:00", endTime: "12:00" }),
      entry({ kind: "shop", startTime: "12:00", endTime: null, running: true }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.running).toBe(true);
    expect(runs[0]?.endTime).toBeNull();
  });

  it("keys a run by its first row, so React holds identity while the day fills in", () => {
    const first = entry({ id: "first", startTime: "08:00", endTime: "12:00" });
    expect(runsForDay([first])[0]?.key).toBe("first");
  });

  it("has nothing to say about an empty day", () => {
    expect(runsForDay([])).toEqual([]);
  });
});

describe("runLength", () => {
  it("measures a break, which is deliberately worth zero PAID hours", () => {
    const [run] = runsForDay([entry({ kind: "break", startTime: "12:00", endTime: "12:30" })]);
    expect(run?.hours).toBe(0);
    // A break showing no figure at all reads as a row that failed to load.
    expect(runLength(run!)).toBe(0.5);
  });
});
