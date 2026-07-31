// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

interface ListArgs {
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

let listArgs: ListArgs[] = [];
let listItems: unknown[] | undefined;
const setTimeEntries = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      timesheets: {
        list: {
          useQuery: (args: ListArgs) => {
            listArgs.push(args);
            return { data: listItems ? { items: listItems } : undefined, isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() };
          },
        },
        count: {
          useQuery: () => ({ data: { total: 7 }, isFetched: true, isError: false, isRefetching: false, refetch: vi.fn() }),
        },
      },
    },
  },
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setTimeEntries: unknown }) => unknown) => sel({ setTimeEntries }),
}));

vi.mock("@/lib/store/dto-mapper", () => ({
  dtoToTimeEntry: (dto: { id: string }) => ({ id: dto.id, mapped: true }),
}));

import { useTimesheetsWeek } from "./use-timesheets-week";

describe("useTimesheetsWeek", () => {
  beforeEach(() => {
    listArgs = [];
    listItems = undefined;
    vi.clearAllMocks();
  });

  // THE BUG. The endpoint always accepted fromDate/toDate; the office panel simply never passed
  // them, so it fetched the newest N entries regardless of the week on screen and any older week
  // rendered empty.
  it("asks the server for the week on screen, not for the newest entries", () => {
    renderHook(() => useTimesheetsWeek({ weekStart: "2026-06-01" }));
    expect(listArgs[0]?.fromDate).toBe("2026-06-01");
  });

  it("closes the range on the Sunday, so Sunday's hours are in the week that contains them", () => {
    renderHook(() => useTimesheetsWeek({ weekStart: "2026-07-27" }));
    expect(listArgs[0]?.toDate).toBe("2026-08-02");
  });

  // toISOString() converts to UTC first, so at a POSITIVE utc offset local midnight lands on the
  // previous UTC day and the range closes a day early, dropping Sunday. Negative offsets (every US
  // timezone) happen to be unaffected, so this only ever shows up somewhere nobody tested.
  it("builds the end date from local parts, not UTC", () => {
    const tz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      renderHook(() => useTimesheetsWeek({ weekStart: "2026-03-02" }));
      expect(listArgs[0]?.toDate).toBe("2026-03-08");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("spans a month boundary without arithmetic on the month", () => {
    renderHook(() => useTimesheetsWeek({ weekStart: "2026-12-28" }));
    expect(listArgs[0]?.toDate).toBe("2027-01-03");
  });

  it("loads the fetched week into the store — the grid reads the store so edits stay optimistic", () => {
    listItems = [{ id: "e1" }, { id: "e2" }];
    renderHook(() => useTimesheetsWeek({ weekStart: "2026-07-27" }));
    expect(setTimeEntries).toHaveBeenCalledWith([
      { id: "e1", mapped: true },
      { id: "e2", mapped: true },
    ]);
  });

  it("does not clear the store while the week is still in flight", () => {
    listItems = undefined; // query has not resolved
    renderHook(() => useTimesheetsWeek({ weekStart: "2026-07-27" }));
    expect(setTimeEntries).not.toHaveBeenCalled();
  });

  it("reports the all-time count separately from the week, so a quiet week is not a new shop", () => {
    listItems = [];
    const { result } = renderHook(() => useTimesheetsWeek({ weekStart: "2026-07-27" }));
    expect(result.current.count).toBe(0);
    expect(result.current.everCount).toBe(7);
  });
});
