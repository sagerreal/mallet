import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore } from "zustand/vanilla";
import { createTimesheetsSlice, type TimesheetsSlice } from "./timesheets-slice";
import { tsKindChange } from "@/features/jobs/timesheet-derive";
import type { TimeEntry } from "@/lib/store/types";

/**
 * Recording a day off, through the store's own write path.
 *
 * WHY THIS FILE EXISTS. Every layer below this one was already right — the domain accepts the shape,
 * the use-case forwards nulls, the database constraint is satisfied, and an integration test proved
 * the whole server chain. And it still did not work: THE STORE'S MUTATION MAPPER silently dropped
 * the two fields that make a row a day off. The office clicked "Time off" and watched the row snap
 * back to Job with no explanation.
 *
 * Two bugs, both of them a guard that looked reasonable in isolation:
 *   - `if ("start" in patch && patch.start != null)` — so `start: null` never travelled, and
 *     CLEARING the punch times is exactly what the conversion is;
 *   - `minutes` had no branch at all, so a day off arrived with no length.
 *
 * The server refused, correctly, and the optimistic row rolled back. A mapper that drops fields is
 * invisible from both ends: the client thinks it sent them and the server never sees them.
 */
const updateMutate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      timesheets: {
        create: { mutate: vi.fn().mockResolvedValue({}) },
        update: { mutate: (...args: unknown[]) => updateMutate(...args) },
        remove: { mutate: vi.fn().mockResolvedValue({}) },
        approveWeek: { mutate: vi.fn().mockResolvedValue({}) },
        reopen: { mutate: vi.fn().mockResolvedValue({}) },
      },
    },
  },
}));

const WORKED: TimeEntry = {
  id: "e1",
  techId: "t1",
  date: "2026-07-24",
  kind: "shop",
  jobId: null,
  start: "08:00",
  end: "16:00",
  minutes: null,
  note: "",
  src: "manual",
  status: "draft",
  running: false,
};

const storeWith = (entries: TimeEntry[]) => {
  const s = createStore<TimesheetsSlice>(createTimesheetsSlice);
  s.getState().setTimeEntries(entries);
  return s;
};

const lastInput = () => updateMutate.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => updateMutate.mockClear());

describe("converting a worked row into a day off", () => {
  it("SENDS the cleared punch times — a null start has to travel or nothing is converted", () => {
    const s = storeWith([WORKED]);
    s.getState().updateTimeEntry("e1", tsKindChange(WORKED, "holiday"));

    expect(lastInput()).toMatchObject({ entryId: "e1", kind: "holiday", startTime: null, endTime: null });
  });

  it("SENDS the length — without it the server gets a day off with no hours and refuses", () => {
    const s = storeWith([WORKED]);
    s.getState().updateTimeEntry("e1", tsKindChange(WORKED, "pto"));

    expect(lastInput().minutes).toBe(480);
  });

  it("sends a time-off KIND at all — the mapper used to be typed to the four clocked kinds", () => {
    const s = storeWith([WORKED]);
    s.getState().updateTimeEntry("e1", tsKindChange(WORKED, "vacation"));

    expect(lastInput().kind).toBe("vacation");
  });

  it("shows the conversion immediately, before the server answers", () => {
    const s = storeWith([WORKED]);
    s.getState().updateTimeEntry("e1", tsKindChange(WORKED, "sick"));

    const row = s.getState().timeEntries.find((e) => e.id === "e1");
    expect(row?.kind).toBe("sick");
    expect(row?.start).toBeNull();
    expect(row?.minutes).toBe(480);
  });
});

describe("converting a day off back to worked time", () => {
  const DAY_OFF: TimeEntry = { ...WORKED, kind: "pto", start: null, end: null, minutes: 480 };

  it("clears the length and sends real times", () => {
    const s = storeWith([DAY_OFF]);
    s.getState().updateTimeEntry("e1", tsKindChange(DAY_OFF, "shop"));

    expect(lastInput()).toMatchObject({ kind: "shop", minutes: null, startTime: "08:00", endTime: "16:00" });
  });
});

describe("what the mapper must not do", () => {
  it("still omits fields the caller did not touch", () => {
    // The fix widened which fields travel; it must not start sending the whole row. A patch that
    // carries fields nobody edited would overwrite concurrent office edits with stale values.
    const s = storeWith([WORKED]);
    s.getState().updateTimeEntry("e1", { note: "swapped the valve" });

    const input = lastInput();
    expect(input.note).toBe("swapped the valve");
    expect("startTime" in input).toBe(false);
    expect("minutes" in input).toBe(false);
    expect("kind" in input).toBe(false);
  });
});
