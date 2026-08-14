/**
 * app/(field)/my-day/visit-cards.test.ts
 *
 * CARDS ARE VISITS. The agenda used to be one row per JOB, which had no honest way to draw a
 * two-stop day: the return trip and the morning stop are different drives at different hours,
 * and a single row can only say one thing. These lock the derivation the redesigned page renders
 * from — which visit becomes a card, which bucket it lands in, and which step its strip shows.
 */
import { describe, it, expect } from "vitest";
import { deriveDayCards, visitStep, type DayCardJob, type DayCardVisit } from "./visit-cards";

const TODAY = "2026-08-12";

let seq = 0;
const visit = (over: Partial<DayCardVisit> = {}): DayCardVisit => {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    status: "pending",
    scheduledDate: TODAY,
    scheduledStart: "09:00",
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    ...over,
  };
};

const job = (over: Partial<DayCardJob> = {}): DayCardJob => {
  seq += 1;
  return {
    id: `11111111-1111-1111-1111-${String(seq).padStart(12, "0")}`,
    status: "scheduled",
    visits: [],
    completedAt: null,
    ...over,
  };
};

describe("visitStep", () => {
  it("maps the visit lifecycle onto the four segments", () => {
    expect(visitStep(visit())).toBe(0);
    expect(visitStep(visit({ enrouteAt: "2026-08-12T15:00:00.000Z" }))).toBe(1);
    expect(visitStep(visit({ status: "in_progress" }))).toBe(2);
    expect(visitStep(visit({ status: "complete" }))).toBe(3);
  });

  it("an on-site visit is on site even if the on-my-way stamp was never sent", () => {
    // The optional-step rule: OMW is a courtesy text, never a gate.
    expect(visitStep(visit({ status: "in_progress", enrouteAt: null }))).toBe(2);
  });
});

describe("deriveDayCards", () => {
  it("makes one card per non-canceled visit, keeping server job order", () => {
    const a = job({ visits: [visit({ scheduledStart: "08:00" })] });
    const b = job({
      visits: [
        visit({ scheduledStart: "13:00" }),
        visit({ scheduledStart: "15:30" }),
        visit({ status: "canceled", scheduledStart: "07:00" }),
      ],
    });
    const { upcoming, finished } = deriveDayCards([a, b], TODAY);
    expect(finished).toHaveLength(0);
    expect(upcoming.map((c) => `${c.jobId}:${c.start}`)).toEqual([
      `${a.id}:08:00`,
      `${b.id}:13:00`,
      `${b.id}:15:30`,
    ]);
  });

  it("orders a job's own visits by date then start, unplaced last", () => {
    const j = job({
      visits: [
        visit({ scheduledDate: null, scheduledStart: null }),
        visit({ scheduledDate: "2026-08-13", scheduledStart: "08:00" }),
        visit({ scheduledDate: TODAY, scheduledStart: "14:00" }),
      ],
    });
    const { upcoming } = deriveDayCards([j], TODAY);
    expect(upcoming.map((c) => c.day)).toEqual([TODAY, "2026-08-13", null]);
  });

  it("buckets a visit completed today into finished, ordered by when it finished", () => {
    const early = job({
      visits: [visit({ status: "complete", completedAt: "2026-08-12T15:10:00.000Z", scheduledStart: "07:00" })],
    });
    const late = job({
      visits: [visit({ status: "complete", completedAt: "2026-08-12T18:40:00.000Z", scheduledStart: "06:00" })],
    });
    const { upcoming, finished } = deriveDayCards([late, early], TODAY);
    expect(upcoming).toHaveLength(0);
    expect(finished.map((c) => c.jobId)).toEqual([early.id, late.id]);
  });

  it("keeps a complete visit with NO finish stamp — legacy rows must not vanish", () => {
    const j = job({ visits: [visit({ status: "complete", completedAt: null })] });
    const { finished } = deriveDayCards([j], TODAY);
    expect(finished).toHaveLength(1);
  });

  it("drops a stop finished on an EARLIER day — the pager's past view owns it", () => {
    // The half-done return-trip shape: stop 1 ran Monday, stop 2 is booked ahead. Monday's card
    // on today's list would say today did work it didn't.
    const j = job({
      visits: [
        visit({ status: "complete", completedAt: "2026-08-10T20:00:00.000Z", scheduledDate: "2026-08-10" }),
        visit({ scheduledDate: "2026-08-14", scheduledStart: "09:00" }),
      ],
    });
    const { upcoming, finished } = deriveDayCards([j], TODAY);
    expect(finished).toHaveLength(0);
    expect(upcoming.map((c) => c.day)).toEqual(["2026-08-14"]);
  });

  it("judges 'today' by the CLIENT's local day, not the UTC date of the instant", () => {
    // 6:40pm Pacific on the 12th is 01:40Z on the 13th. The tech who finished it is still living
    // the 12th; the card must not vanish into 'yesterday' because UTC rolled over.
    const j = job({
      status: "complete",
      visits: [visit({ status: "complete", completedAt: "2026-08-13T01:40:00.000Z" })],
    });
    const local = new Date("2026-08-13T01:40:00.000Z");
    const localDay = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    const { finished } = deriveDayCards([j], localDay);
    expect(finished).toHaveLength(1);
  });

  it("gives a visit-less job ONE job-level card so no work goes missing", () => {
    const open = job({ status: "scheduled" });
    const doneToday = job({ status: "complete", completedAt: "2026-08-12T16:00:00.000Z" });
    const { upcoming, finished } = deriveDayCards([open, doneToday], TODAY);
    expect(upcoming.map((c) => `${c.jobId}:${String(c.visitId)}`)).toEqual([`${open.id}:null`]);
    expect(finished.map((c) => c.jobId)).toEqual([doneToday.id]);
    expect(upcoming[0]?.step).toBe(0);
    expect(finished[0]?.step).toBe(3);
  });

  it("slots a job-level finish into the worked order, not pinned to the top", () => {
    const visitDone = job({
      visits: [visit({ status: "complete", completedAt: "2026-08-12T09:00:00.000Z" })],
    });
    const jobDone = job({ status: "complete", completedAt: "2026-08-12T14:00:00.000Z" });
    const { finished } = deriveDayCards([jobDone, visitDone], TODAY);
    expect(finished.map((c) => c.jobId)).toEqual([visitDone.id, jobDone.id]);
  });

  it("skips a canceled job outright — a called-off job is not a stop", () => {
    const j = job({ status: "canceled", visits: [visit()] });
    const { upcoming, finished } = deriveDayCards([j], TODAY);
    expect(upcoming).toHaveLength(0);
    expect(finished).toHaveLength(0);
  });

  it("keys every card uniquely, visit-level and job-level alike", () => {
    const two = job({ visits: [visit(), visit()] });
    const bare = job();
    const { upcoming } = deriveDayCards([two, bare], TODAY);
    const keys = upcoming.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * The bug: a stop booked Tuesday, still open on Friday, sat under a heading that says Today.
 *
 * The server returns ALL open work on purpose — a job booked Tuesday and never done is still owed —
 * so the fix is not to hide it. It is to stop calling it Upcoming.
 */
describe("deriveDayCards — work booked before today", () => {
  it("puts a stop booked on an earlier day in OVERDUE, not upcoming", () => {
    const cards = deriveDayCards([job({ visits: [visit({ scheduledDate: "2026-08-11" })] })], TODAY);
    expect(cards.overdue).toHaveLength(1);
    expect(cards.upcoming).toHaveLength(0);
  });

  it("leaves today's own stops in upcoming", () => {
    const cards = deriveDayCards([job({ visits: [visit({ scheduledDate: TODAY })] })], TODAY);
    expect(cards.overdue).toHaveLength(0);
    expect(cards.upcoming).toHaveLength(1);
  });

  it("does not call a FUTURE booking overdue", () => {
    const cards = deriveDayCards([job({ visits: [visit({ scheduledDate: "2026-08-20" })] })], TODAY);
    expect(cards.overdue).toHaveLength(0);
    expect(cards.upcoming).toHaveLength(1);
  });

  it("never calls a finished stop overdue — it is finished", () => {
    const cards = deriveDayCards(
      [job({ visits: [visit({ scheduledDate: "2026-08-11", status: "complete", completedAt: `${TODAY}T15:00:00Z` })] })],
      TODAY,
    );
    expect(cards.overdue).toHaveLength(0);
    expect(cards.finished).toHaveLength(1);
  });

  it("leaves an UNSCHEDULED job in upcoming — unplanned is not late", () => {
    const cards = deriveDayCards([job({ status: "scheduled", visits: [] })], TODAY);
    expect(cards.overdue).toHaveLength(0);
    expect(cards.upcoming).toHaveLength(1);
  });

  it("puts the longest-waiting stop first", () => {
    const cards = deriveDayCards(
      [job({ visits: [visit({ scheduledDate: "2026-08-11" }), visit({ scheduledDate: "2026-08-05" })] })],
      TODAY,
    );
    expect(cards.overdue.map((c) => c.day)).toEqual(["2026-08-05", "2026-08-11"]);
  });
});
