import { describe, it, expect } from "vitest";
import { serviceDateFromVisits } from "./service-date-reader";

const visit = (status: string, completedAt: string | null) => ({
  status,
  completedAt: completedAt === null ? null : new Date(completedAt),
});

describe("serviceDateFromVisits", () => {
  it("has no answer for a job with no visits", () => {
    expect(serviceDateFromVisits([])).toBeNull();
  });

  it("has no answer while the work is still scheduled", () => {
    // A booked-but-unworked job must not print a service date — the customer would read a date
    // for work nobody has done yet.
    expect(serviceDateFromVisits([visit("pending", null), visit("in_progress", null)])).toBeNull();
  });

  it("takes the completed visit's own stamp", () => {
    expect(serviceDateFromVisits([visit("complete", "2026-08-03T17:40:00Z")])).toEqual(
      new Date("2026-08-03T17:40:00Z"),
    );
  });

  it("takes the LATEST completed visit — the bill is for work that finished then", () => {
    const stamps = [
      visit("complete", "2026-08-03T17:40:00Z"),
      visit("complete", "2026-08-06T14:05:00Z"),
      visit("complete", "2026-08-04T09:00:00Z"),
    ];
    expect(serviceDateFromVisits(stamps)).toEqual(new Date("2026-08-06T14:05:00Z"));
  });

  it("ignores canceled visits entirely", () => {
    const stamps = [
      visit("complete", "2026-08-03T17:40:00Z"),
      // A canceled visit can still carry a stale stamp; it records no work, so it cannot be the
      // service date — and being the latest must not make it one.
      visit("canceled", "2026-08-09T12:00:00Z"),
    ];
    expect(serviceDateFromVisits(stamps)).toEqual(new Date("2026-08-03T17:40:00Z"));
  });

  it("treats a completed visit with no stamp as unknown, never as today", () => {
    // Absent means nobody's tap wrote a time. Back-filling it would put a fabricated date on a
    // document a customer may hand to an insurer.
    expect(serviceDateFromVisits([visit("complete", null)])).toBeNull();
  });

  it("still answers when one of several completed visits has no stamp", () => {
    const stamps = [visit("complete", null), visit("complete", "2026-08-03T17:40:00Z")];
    expect(serviceDateFromVisits(stamps)).toEqual(new Date("2026-08-03T17:40:00Z"));
  });
});
