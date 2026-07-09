import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import { mkJob, mkVisit, mkInvoice } from "./test-factories";
import {
  jobTotal,
  deriveOnTrucks,
  todayVisit,
  deriveJobBands,
  deriveArchivedBands,
  isArchivedJob,
  jobDoneDate,
  JOB_ARCHIVE_AFTER_DAYS,
} from "./today-derive";

const priced = (amt: number) => [{ d: "Work", q: 1, r: amt }];

describe("jobTotal", () => {
  it("sums quantity × rate across lines", () => {
    expect(jobTotal(mkJob({ lines: [{ d: "a", q: 2, r: 100 }, { d: "b", q: 1, r: 50 }] }))).toBe(250);
  });
  it("defaults a missing quantity to 1", () => {
    expect(jobTotal(mkJob({ lines: [{ d: "a", q: undefined as unknown as number, r: 75 }] }))).toBe(75);
  });
});

describe("deriveOnTrucks", () => {
  it("counts only today's placed, not-done job dollars", () => {
    const jobs = [
      mkJob({ id: "1", lines: priced(500), visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9 })] }),
      mkJob({ id: "2", lines: priced(999), status: "done", visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9 })] }),
      mkJob({ id: "3", lines: priced(300), visits: [mkVisit({ date: dPlus(1), techId: "1", start: 9 })] }),
      mkJob({ id: "4", lines: priced(200), visits: [mkVisit({ id: "9" })] }), // unplaced
    ];
    expect(deriveOnTrucks(jobs)).toBe(500);
  });
});

describe("todayVisit", () => {
  it("returns today's placed visit or null", () => {
    expect(todayVisit(mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9 })] }))).not.toBeNull();
    expect(todayVisit(mkJob({ visits: [mkVisit({ date: dPlus(1), techId: "1", start: 9 })] }))).toBeNull();
  });
});

describe("jobDoneDate", () => {
  it("returns the latest done visit date, ignoring non-done visits", () => {
    expect(jobDoneDate(mkJob({ visits: [] }))).toBeNull();
    expect(jobDoneDate(mkJob({ visits: [mkVisit({ date: dPlus(-1), status: "scheduled" })] }))).toBeNull();
    const j = mkJob({
      visits: [mkVisit({ id: "1", date: dPlus(-3), status: "done" }), mkVisit({ id: "2", date: dPlus(-1), status: "done" })],
    });
    expect(jobDoneDate(j)).toBe(dPlus(-1));
  });
});

describe("auto-archive", () => {
  const doneVisit = (daysAgo: number) => mkVisit({ date: dPlus(-daysAgo), techId: "1", start: 9, status: "done" });

  it("archives a done + billed job that wrapped a week+ ago", () => {
    const j = mkJob({ id: "1", status: "done", leadId: "5", lines: priced(300), visits: [doneVisit(JOB_ARCHIVE_AFTER_DAYS)] });
    const inv = mkInvoice({ id: "inv-1", jobId: "1", leadId: "5" });
    expect(isArchivedJob(j, [inv])).toBe(true);
    expect(deriveJobBands([j], [inv]).find((b) => b.key === "done")).toBeUndefined();
    expect(deriveArchivedBands([j], [inv])[0]?.jobs.map((x) => x.id)).toEqual(["1"]);
  });

  it("keeps a recently-done billed job active", () => {
    const j = mkJob({ id: "1", status: "done", leadId: "5", lines: priced(300), visits: [doneVisit(2)] });
    const inv = mkInvoice({ id: "inv-1", jobId: "1", leadId: "5" });
    expect(isArchivedJob(j, [inv])).toBe(false);
    expect(deriveJobBands([j], [inv]).find((b) => b.key === "done")?.jobs.map((x) => x.id)).toEqual(["1"]);
  });

  it("never auto-archives an unbilled done job, even if old — the leak stays visible", () => {
    const j = mkJob({ id: "1", status: "done", leadId: "5", lines: priced(480), visits: [doneVisit(30)] });
    expect(isArchivedJob(j, [])).toBe(false);
    expect(deriveJobBands([j], []).find((b) => b.key === "doneUnbilled")?.jobs.map((x) => x.id)).toEqual(["1"]);
  });

  it("treats an explicitly-archived job as archived and out of the active bands", () => {
    const j = mkJob({ id: "1", archived: true, status: "unscheduled", lines: priced(100) });
    expect(isArchivedJob(j, [])).toBe(true);
    expect(deriveJobBands([j], [])).toEqual([]);
    expect(deriveArchivedBands([j], [])[0]?.jobs.map((x) => x.id)).toEqual(["1"]);
  });
});

describe("deriveJobBands — every job lands in exactly one band", () => {
  it("splits scheduled work so a today job never also appears in a week band", () => {
    const todayJob = mkJob({ id: "1", lines: priced(100), visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9 })] });
    const weekJob = mkJob({ id: "2", lines: priced(100), visits: [mkVisit({ date: dPlus(3), techId: "1", start: 9 })] });
    const laterJob = mkJob({ id: "3", lines: priced(100), visits: [mkVisit({ date: dPlus(20), techId: "1", start: 9 })] });
    const bands = deriveJobBands([todayJob, weekJob, laterJob], []);

    const idsIn = (key: string) => bands.find((b) => b.key === key)?.jobs.map((j) => j.id) ?? [];
    expect(idsIn("today")).toEqual(["1"]);
    expect(idsIn("thisWeek")).toEqual(["2"]);
    expect(idsIn("later")).toEqual(["3"]);

    // no job id appears in two bands
    const allIds = bands.flatMap((b) => b.jobs.map((j) => j.id));
    expect(allIds.length).toBe(new Set(allIds).size);
  });

  it("routes done jobs to billed vs not-billed and tags the leaks amber", () => {
    const unbilled = mkJob({ id: "1", status: "done", lines: priced(480), leadId: "10" });
    const billed = mkJob({ id: "2", status: "done", lines: priced(300), leadId: "20" });
    const inv = mkInvoice({ id: "inv-1", jobId: "2", leadId: "20" });
    const bands = deriveJobBands([unbilled, billed], [inv]);

    const du = bands.find((b) => b.key === "doneUnbilled");
    const done = bands.find((b) => b.key === "done");
    expect(du?.jobs.map((j) => j.id)).toEqual(["1"]);
    expect(du?.amber).toBe(true);
    expect(du?.sum).toBe(480);
    expect(done?.jobs.map((j) => j.id)).toEqual(["2"]);
    expect(done?.amber).toBe(false);
  });

  it("matches an invoice by lead when it carries no job id", () => {
    const j = mkJob({ id: "1", status: "done", leadId: "55", lines: priced(200) });
    const inv = mkInvoice({ id: "inv-1", jobId: null, leadId: "55" });
    const bands = deriveJobBands([j], [inv]);
    expect(bands.find((b) => b.key === "doneUnbilled")).toBeUndefined();
    expect(bands.find((b) => b.key === "done")?.jobs.map((j) => j.id)).toEqual(["1"]);
  });

  it("omits empty bands and puts unscheduled jobs in the amber Needs-a-slot band", () => {
    const j = mkJob({ id: "1", status: "unscheduled", lines: priced(2150), visits: [] });
    const bands = deriveJobBands([j], []);
    const keys = bands.map((b) => b.key);
    expect(keys).toContain("needsSlot");
    expect(keys).not.toContain("today");
    expect(bands.find((b) => b.key === "needsSlot")?.amber).toBe(true);
  });
});
