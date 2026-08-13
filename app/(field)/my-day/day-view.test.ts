import { describe, it, expect } from "vitest";
import { deriveDayView, minutesLabel } from "./day-view";

const DAY = "2026-08-14";

let seq = 0;
const visit = (over: Record<string, unknown> = {}) => {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    status: "pending",
    scheduledDate: DAY,
    scheduledStart: "09:00",
    durationMinutes: 60,
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    ...over,
  };
};
const job = (visits: unknown[], status = "scheduled") => {
  seq += 1;
  return { id: `11111111-1111-1111-1111-${String(seq).padStart(12, "0")}`, status, completedAt: null, visits } as never;
};

describe("deriveDayView", () => {
  it("makes cards ONLY from visits dated the viewed day — a multi-visit job's other stops ride the DTO but not the view", () => {
    const j = job([
      visit({ scheduledDate: DAY, scheduledStart: "10:00" }),
      visit({ scheduledDate: "2026-08-15", scheduledStart: "08:00" }),
      visit({ scheduledDate: null }),
    ]);
    const view = deriveDayView([j], DAY);
    expect(view.open).toHaveLength(1);
    expect(view.open[0]?.day).toBe(DAY);
  });

  it("buckets a complete visit as finished regardless of when its stamp landed", () => {
    // The date FILTER scoped the day; a stop worked late (stamped after midnight) still belongs
    // to the day it was booked when you are LOOKING at that day.
    const j = job([visit({ status: "complete", completedAt: "2026-08-15T02:10:00.000Z" })]);
    const view = deriveDayView([j], DAY);
    expect(view.finished).toHaveLength(1);
    expect(view.open).toHaveLength(0);
  });

  it("orders each bucket by the day's own clock", () => {
    const a = job([visit({ scheduledStart: "13:00" })]);
    const b = job([visit({ scheduledStart: "07:30" })]);
    const view = deriveDayView([a, b], DAY);
    expect(view.open.map((c) => c.start)).toEqual(["07:30", "13:00"]);
  });

  it("sums the day's booked minutes and counts distinct jobs", () => {
    const twoStops = job([
      visit({ durationMinutes: 45 }),
      visit({ durationMinutes: 30, scheduledStart: "14:00" }),
    ]);
    const other = job([visit({ durationMinutes: 60 })]);
    const view = deriveDayView([twoStops, other], DAY);
    expect(view.scheduledMinutes).toBe(135);
    expect(view.jobCount).toBe(2);
  });

  it("skips canceled visits and canceled jobs", () => {
    const canceledVisit = job([visit({ status: "canceled" })]);
    const canceledJob = job([visit()], "canceled");
    const view = deriveDayView([canceledVisit, canceledJob], DAY);
    expect(view.open).toHaveLength(0);
    expect(view.jobCount).toBe(0);
  });
});

describe("minutesLabel", () => {
  it("renders hours and minutes", () => {
    expect(minutesLabel(0)).toBe("0h 0m");
    expect(minutesLabel(465)).toBe("7h 45m");
  });
});
