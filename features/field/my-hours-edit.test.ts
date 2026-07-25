import { describe, it, expect } from "vitest";
import {
  EDIT_WINDOW_DAYS,
  editWindowDates,
  isWithinEditWindow,
  editabilityOf,
  dayLockNotes,
  suggestEndTime,
  openEntryOf,
  timesProblem,
  approvedReason,
} from "./my-hours-edit";
import type { MyHoursEntry } from "./my-hours-derive";

// @/lib/clock is mocked globally to 2026-07-01 (a Wednesday) — see vitest.setup.ts.
const TODAY = "2026-07-01";
const ME = "11111111-1111-1111-1111-111111111111";
const SOMEONE_ELSE = "22222222-2222-2222-2222-222222222222";

const entry = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => ({
  id: "e1",
  techUserId: ME,
  jobId: null,
  workDate: TODAY,
  kind: "shop",
  startTime: "07:42",
  endTime: "16:00",
  note: "",
  src: "clock",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: "2026-07-01T14:42:00.000Z",
  ...over,
});

describe("the editing window", () => {
  it("covers the current day and the previous six", () => {
    const dates = editWindowDates(TODAY);

    expect(dates).toHaveLength(EDIT_WINDOW_DAYS);
    expect(dates[0]).toBe("2026-07-01");
    expect(dates[EDIT_WINDOW_DAYS - 1]).toBe("2026-06-25");
  });

  it("admits the oldest day in the window and refuses the day before it", () => {
    expect(isWithinEditWindow("2026-06-25", TODAY)).toBe(true);
    expect(isWithinEditWindow("2026-06-24", TODAY)).toBe(false);
  });

  it("refuses a date after today — hours cannot be booked in advance", () => {
    expect(isWithinEditWindow("2026-07-02", TODAY)).toBe(false);
  });

  it("locks a row older than the window, naming the next step", () => {
    const result = editabilityOf(entry({ workDate: "2026-06-24" }), TODAY, ME);

    expect(result.editable).toBe(false);
    expect(result.editable === false && result.reason).toBe(
      "Older than 7 days — ask the office to change it.",
    );
  });

  it("still lets the technician correct the oldest day inside the window", () => {
    expect(editabilityOf(entry({ workDate: "2026-06-25" }), TODAY, ME).editable).toBe(true);
  });
});

describe("what a technician may correct", () => {
  it("locks an approved row and says when it was approved and who to ask", () => {
    const approved = entry({ status: "approved", approvedAt: "2026-07-21T12:00:00.000Z" });

    const result = editabilityOf(approved, TODAY, ME);

    expect(result.editable).toBe(false);
    // Locale-independent: the date renders in the reader's own format.
    expect(result.editable === false && result.reason).toMatch(
      /^Approved .*21.* — ask the office to reopen$/,
    );
  });

  it("locks an approved row even when it is today's — approval outranks the window", () => {
    expect(editabilityOf(entry({ status: "approved" }), TODAY, ME).editable).toBe(false);
  });

  it("locks another technician's row — My hours is not the office grid", () => {
    const result = editabilityOf(entry({ techUserId: SOMEONE_ELSE }), TODAY, ME);

    expect(result.editable).toBe(false);
    expect(result.editable === false && result.reason).toBe(
      "These aren't your hours — the office timesheet edits them.",
    );
  });

  it("locks everything while the caller's identity is still unknown", () => {
    expect(editabilityOf(entry(), TODAY, undefined).editable).toBe(false);
  });

  it("lets a still-running row be closed however old it is — an open day blocks approval", () => {
    const forgotten = entry({ workDate: "2026-06-12", endTime: null, running: true });

    expect(editabilityOf(forgotten, TODAY, ME).editable).toBe(true);
  });

  it("states each distinct lock reason once per day, not once per row", () => {
    const approvedAt = "2026-07-21T12:00:00.000Z";
    const day = [
      entry({ id: "a", status: "approved", approvedAt }),
      entry({ id: "b", status: "approved", approvedAt }),
      entry({ id: "c" }),
    ];

    expect(dayLockNotes(day, TODAY, ME)).toEqual([approvedReason(approvedAt)]);
  });

  it("says nothing about a day whose rows are all editable", () => {
    expect(dayLockNotes([entry()], TODAY, ME)).toEqual([]);
  });
});

describe("suggesting an end for a day left open", () => {
  const running = entry({ id: "open", startTime: "07:42", endTime: null, running: true });

  it("offers the end of the last completed activity that day", () => {
    const day = [running, entry({ id: "j1", endTime: "12:05" }), entry({ id: "j2", endTime: "16:12" })];

    expect(suggestEndTime(day, running)).toBe("16:12");
  });

  it("offers nothing when every other block that day ended before the open one started", () => {
    const day = [running, entry({ id: "j1", startTime: "06:00", endTime: "07:00" })];

    expect(suggestEndTime(day, running)).toBeNull();
  });

  it("offers nothing from a different day — a suggestion must come from the day it closes", () => {
    const day = [running, entry({ id: "j1", workDate: "2026-06-30", endTime: "18:00" })];

    expect(suggestEndTime(day, running)).toBeNull();
  });

  // A segment that started at 07:42 and is being viewed hours later — a forgotten punch.
  const LONG_AFTER = new Date(`${TODAY}T20:00:00`);
  // The same segment viewed three minutes in — the technician is standing in it.
  const JUST_STARTED = new Date(`${TODAY}T07:45:00`);

  it("finds the caller's own open row and ignores another technician's", () => {
    const theirs = entry({ id: "theirs", techUserId: SOMEONE_ELSE, endTime: null, running: true });

    expect(openEntryOf([theirs, running], ME, LONG_AFTER)?.id).toBe("open");
    expect(openEntryOf([theirs], ME, LONG_AFTER)).toBeNull();
  });

  // A reviewer found the banner firing three minutes after Start day, on the happy path, every
  // time anyone opened the screen. A warning that is usually wrong is one people learn to dismiss.
  it("says nothing about the segment the technician is currently inside", () => {
    expect(openEntryOf([running], ME, JUST_STARTED)).toBeNull();
  });

  it("still flags it once it has been open long enough to be forgotten", () => {
    expect(openEntryOf([running], ME, LONG_AFTER)?.id).toBe("open");
  });
});

describe("refusing times that cannot become hours", () => {
  it("names a missing time", () => {
    expect(timesProblem("08:00", "")).toBe("Set both a start and an end time.");
  });

  it("names an end that is not after the start — the domain rejects it too", () => {
    expect(timesProblem("08:00", "08:00")).toBe("The end time has to be after the start time.");
    expect(timesProblem("08:00", "07:00")).toBe("The end time has to be after the start time.");
  });

  it("passes a real range", () => {
    expect(timesProblem("08:00", "16:30")).toBeNull();
  });
});
