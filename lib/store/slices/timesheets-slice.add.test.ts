import { describe, it, expect, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createTimesheetsSlice, type TimesheetsSlice } from "./timesheets-slice";
import { TS_DEFAULT_START, TS_DEFAULT_END } from "@/features/jobs/timesheet-constants";

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      timesheets: {
        create: { mutate: vi.fn().mockResolvedValue({}) },
        update: { mutate: vi.fn().mockResolvedValue({}) },
        remove: { mutate: vi.fn().mockResolvedValue({}) },
        approveWeek: { mutate: vi.fn().mockResolvedValue({}) },
        reopen: { mutate: vi.fn().mockResolvedValue({}) },
      },
    },
  },
}));

const store = () => createStore<TimesheetsSlice>(createTimesheetsSlice);
const TECH = "tech-1";
const today = () => new Date().toISOString().slice(0, 10);

// Regression guard. `addTimeEntry` used to branch on "is this date today?" and hand back an
// OPEN-ENDED running timer. That entry was unusable from every direction: the row editor refuses
// to open for a running entry, so its hours could never be filled in; hours() returns null so it
// never totalled; approval skipped it; and the QuickBooks push rejects it as `entry_not_finished`.
// Recording work that already happened must always yield a complete, editable entry.
describe("addTimeEntry — a recorded entry is always complete", () => {
  it.each([
    ["today", today()],
    ["a past day", "2026-07-20"],
    ["a future day", "2099-01-01"],
  ])("sets both start and end for %s", (_label, date) => {
    const entry = store().getState().addTimeEntry(TECH, date);

    expect(entry.start).toBe(TS_DEFAULT_START);
    expect(entry.end).toBe(TS_DEFAULT_END);
  });

  it("is never created as a running timer — not even for today", () => {
    expect(store().getState().addTimeEntry(TECH, today()).running).toBe(false);
  });

  it("produces an entry with a real duration, so it can be totalled and approved", () => {
    const entry = store().getState().addTimeEntry(TECH, today());
    expect(entry.end).not.toBeNull();
    expect(entry.end).not.toBe(entry.start);
  });

  it("starts as an editable draft", () => {
    expect(store().getState().addTimeEntry(TECH, today()).status).toBe("draft");
  });

  it("adds it to the store", () => {
    const s = store();
    const entry = s.getState().addTimeEntry(TECH, today());
    expect(s.getState().timeEntries.map((e) => e.id)).toContain(entry.id);
  });
});
