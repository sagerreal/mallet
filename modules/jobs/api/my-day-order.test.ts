/**
 * modules/jobs/api/my-day-order.test.ts
 *
 * My day sorted on `jobs.scheduled_start` — a column no live path writes, with zero non-null rows
 * in the pilot org. The comparator was therefore "equal" for every pair and the agenda came back
 * ordered by random v4 UUID. These lock the replacement: the earliest LIVE visit, compared as the
 * wall-clock text the board itself uses.
 */
import { describe, it, expect } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asVisitId,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import { earliestLiveVisitAt, byAgenda } from "./my-day-order";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");

const makeVisit = (over: Partial<JobVisitProps> = {}): JobVisit => {
  const r = JobVisit.create({
    id: asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: null,
    status: "pending",
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
    ...over,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

let jobSeq = 0;
const makeJob = (over: Partial<JobProps> = {}): Job => {
  jobSeq += 1;
  const r = Job.create({
    id: asJobId(`11111111-1111-1111-1111-${String(jobSeq).padStart(12, "0")}`),
    orgId: ORG,
    num: `JOB-${9000 + jobSeq}`,
    leadId: LEAD,
    addr: null,
    phone: null,
    completion: null,
    invRequested: false,
    taxBps: 0,
    tax: zeroMoney,
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Water heater",
    svc: null,
    kind: "work",
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    scope: null,
    callbackOf: null,
    callbackReason: null,
    checklist: null,
    requiredCerts: null,
    visits: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...over,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

describe("earliestLiveVisitAt", () => {
  it("is null for a job with no visits at all", () => {
    expect(earliestLiveVisitAt(makeJob())).toBeNull();
  });

  it("is null when the only visit has no date — unplaced work has no slot in the route", () => {
    expect(earliestLiveVisitAt(makeJob({ visits: [makeVisit({ scheduledStart: "09:00" })] }))).toBeNull();
  });

  it("takes the EARLIEST of several visits, not the first in the array", () => {
    const job = makeJob({
      visits: [
        makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "15:00" }),
        makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "08:30" }),
      ],
    });
    expect(earliestLiveVisitAt(job)).toBe("2026-08-04T08:30");
  });

  it("ignores a canceled visit but keeps a COMPLETE one", () => {
    // Job.complete() closes open visits to `complete`, not `canceled` — which is exactly why a
    // finished job keeps its slot in the route instead of falling off the end of the day.
    const job = makeJob({
      visits: [
        makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "07:00", status: "canceled" }),
        makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "11:00", status: "complete" }),
      ],
    });
    expect(earliestLiveVisitAt(job)).toBe("2026-08-04T11:00");
  });

  it("treats a dated visit with no start time as the top of that day, not as unplaced", () => {
    const job = makeJob({ visits: [makeVisit({ scheduledDate: "2026-08-04" })] });
    expect(earliestLiveVisitAt(job)).toBe("2026-08-04T00:00");
  });
});

describe("byAgenda", () => {
  const at = (date: string, start: string) =>
    makeJob({ visits: [makeVisit({ scheduledDate: date, scheduledStart: start })] });

  it("orders a day by the clock, earliest first", () => {
    const nine = at("2026-08-04", "09:00");
    const seven = at("2026-08-04", "07:30");
    const one = at("2026-08-04", "13:00");
    expect([nine, one, seven].sort(byAgenda).map((j) => j.props.num)).toEqual([
      seven.props.num,
      nine.props.num,
      one.props.num,
    ]);
  });

  it("puts a finished job back in ITS slot, not at the end", () => {
    const doneAtEight = makeJob({
      status: "complete",
      visits: [makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "08:00", status: "complete" })],
    });
    const nextAtTen = at("2026-08-04", "10:00");
    expect([nextAtTen, doneAtEight].sort(byAgenda).map((j) => j.props.num)).toEqual([
      doneAtEight.props.num,
      nextAtTen.props.num,
    ]);
  });

  it("sorts work with no date LAST — visible, but not at the head of the route", () => {
    const undated = makeJob();
    const nine = at("2026-08-04", "09:00");
    expect([undated, nine].sort(byAgenda).map((j) => j.props.num)).toEqual([
      nine.props.num,
      undated.props.num,
    ]);
  });

  it("breaks a tie deterministically, so the same day renders the same way twice", () => {
    const a = makeJob({
      createdAt: new Date("2026-08-01T00:00:00Z"),
      visits: [makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "09:00" })],
    });
    const b = makeJob({
      createdAt: new Date("2026-08-02T00:00:00Z"),
      visits: [makeVisit({ scheduledDate: "2026-08-04", scheduledStart: "09:00" })],
    });
    expect([b, a].sort(byAgenda).map((j) => j.props.num)).toEqual([a.props.num, b.props.num]);
    expect([a, b].sort(byAgenda).map((j) => j.props.num)).toEqual([a.props.num, b.props.num]);
  });
});
