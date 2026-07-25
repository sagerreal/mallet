import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "zustand/vanilla";
import { createTimesheetsSlice, type TimesheetsSlice } from "./timesheets-slice";
import { subscribeWriteErrors, resetWriteErrorListeners } from "../write-error";
import { APP_ERROR_FIELD } from "@/lib/trpc/error-map";
import { UNFINISHED_DAYS_TAG } from "@/features/jobs/timesheet-constants";
import { UNFINISHED_DAYS } from "@/modules/timesheets/app/approve-week";
import { tsWeekDates } from "@/features/jobs/timesheet-derive";
import type { TimeEntry } from "../types";

const { approveWeekMock } = vi.hoisted(() => ({ approveWeekMock: vi.fn() }));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      timesheets: {
        create: { mutate: vi.fn().mockResolvedValue({}) },
        update: { mutate: vi.fn().mockResolvedValue({}) },
        remove: { mutate: vi.fn().mockResolvedValue({}) },
        approveWeek: { mutate: approveWeekMock },
        reopen: { mutate: vi.fn().mockResolvedValue({}) },
      },
    },
  },
}));

const TECH = "tech-1";
const WEEK = tsWeekDates("2026-06-29");

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: "e1",
  techId: TECH,
  date: "2026-06-29",
  kind: "job",
  jobId: null,
  start: "08:00",
  end: "16:00",
  note: "",
  src: "clock",
  status: "draft",
  running: false,
  ...over,
});

/** The wire shape of a refusal: a code, a sentence for humans, and the machine-readable tag. */
const refusal = (tag: string) => ({
  data: { code: "BAD_REQUEST", [APP_ERROR_FIELD]: tag },
  message: "These days still have hours with no end time: 2026-06-30. Finish or remove them, then approve.",
});

const store = (entries: TimeEntry[]) => {
  const s = createStore<TimesheetsSlice>(createTimesheetsSlice);
  s.getState().setTimeEntries(entries);
  return s;
};

describe("approveTechWeek", () => {
  beforeEach(() => {
    approveWeekMock.mockReset();
    resetWriteErrorListeners();
  });
  afterEach(() => resetWriteErrorListeners());

  it("reports approval when the server accepts the week", async () => {
    approveWeekMock.mockResolvedValue({ approved: 1 });
    const s = store([entry({})]);

    const outcome = await s.getState().approveTechWeek(TECH, WEEK);

    expect(outcome.status).toBe("approved");
    expect(s.getState().timeEntries[0]?.status).toBe("approved");
  });

  it("names the unfinished days when the server refuses the week", async () => {
    approveWeekMock.mockRejectedValue(refusal(UNFINISHED_DAYS_TAG));
    const s = store([
      entry({ id: "e1", date: "2026-06-29", end: "16:00" }),
      entry({ id: "e2", date: "2026-06-30", end: null, running: true }),
      entry({ id: "e3", date: "2026-07-02", end: null }),
    ]);

    const outcome = await s.getState().approveTechWeek(TECH, WEEK);

    expect(outcome).toEqual({ status: "unfinished", days: ["2026-06-30", "2026-07-02"] });
  });

  it("puts the week back the way it was when approval is refused", async () => {
    approveWeekMock.mockRejectedValue(refusal(UNFINISHED_DAYS_TAG));
    const s = store([entry({ id: "e1" }), entry({ id: "e2", date: "2026-06-30", end: null, running: true })]);

    await s.getState().approveTechWeek(TECH, WEEK);

    expect(s.getState().timeEntries.map((e) => e.status)).toEqual(["draft", "draft"]);
  });

  it("does not raise the generic write-error toast for a refusal it explains itself", async () => {
    approveWeekMock.mockRejectedValue(refusal(UNFINISHED_DAYS_TAG));
    const seen = vi.fn();
    subscribeWriteErrors(seen);

    await store([entry({ end: null, running: true })]).getState().approveTechWeek(TECH, WEEK);

    expect(seen).not.toHaveBeenCalled();
  });

  it("falls back to the write-error toast for any other failure", async () => {
    approveWeekMock.mockRejectedValue({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "boom" });
    const seen = vi.fn();
    subscribeWriteErrors(seen);
    const s = store([entry({})]);

    const outcome = await s.getState().approveTechWeek(TECH, WEEK);

    expect(outcome.status).toBe("failed");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(s.getState().timeEntries[0]?.status).toBe("draft");
  });

  it("does not treat a differently-tagged refusal as an unfinished week", async () => {
    approveWeekMock.mockRejectedValue(refusal("someOtherRule"));

    const outcome = await store([entry({ end: null, running: true })]).getState().approveTechWeek(TECH, WEEK);

    expect(outcome.status).toBe("failed");
  });
});

// The client cannot import the module's constant — that would pull the timesheets router, and with
// it the database layer, into the browser bundle — so the tag is restated in timesheet-constants.
// This is the guard that the two spellings stay one wire contract.
describe("the unfinished-week tag", () => {
  it("matches the tag the server puts on the refusal", () => {
    expect(UNFINISHED_DAYS_TAG).toBe(UNFINISHED_DAYS);
  });
});
