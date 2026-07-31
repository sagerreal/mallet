// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

interface ListArgs {
  visitFrom?: string;
  visitTo?: string;
  limit?: number;
}

let listArgs: ListArgs[] = [];
let listItems: unknown[] | undefined;
const mergeJobs = vi.fn();
const setJobs = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      jobs: {
        list: {
          useQuery: (args: ListArgs) => {
            listArgs.push(args);
            return {
              data: listItems ? { items: listItems } : undefined,
              isFetched: true,
              isError: false,
              isRefetching: false,
              refetch: vi.fn(),
            };
          },
        },
      },
    },
  },
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { mergeJobs: unknown; setJobs: unknown }) => unknown) =>
    sel({ mergeJobs, setJobs }),
}));

vi.mock("@/lib/store/dto-mapper", () => ({
  dtoJobToStoreJob: (dto: { id: string }) => ({ id: dto.id, mapped: true }),
}));

import { useScheduleWindow } from "./use-schedule-window";

describe("useScheduleWindow", () => {
  beforeEach(() => {
    listArgs = [];
    listItems = undefined;
    vi.clearAllMocks();
  });

  // THE BUG. The board is date-scoped but read the store's newest page, so any day outside that
  // page drew an empty grid — which on a scheduling screen reads as "this slot is free".
  it("asks the server for the dates on screen", () => {
    renderHook(() => useScheduleWindow({ from: "2026-09-14", to: "2026-09-20" }));
    expect(listArgs[0]?.visitFrom).toBe("2026-09-14");
    expect(listArgs[0]?.visitTo).toBe("2026-09-20");
  });

  it("MERGES the window into the store — a dozen other surfaces read that collection", () => {
    listItems = [{ id: "j1" }, { id: "j2" }];
    renderHook(() => useScheduleWindow({ from: "2026-09-14", to: "2026-09-14" }));
    expect(mergeJobs).toHaveBeenCalledWith([
      { id: "j1", mapped: true },
      { id: "j2", mapped: true },
    ]);
    // Replacing would empty the Jobs list, the modals and the pipeline the moment the board opened.
    expect(setJobs).not.toHaveBeenCalled();
  });

  it("does not touch the store for an empty day — there is nothing to merge", () => {
    listItems = [];
    renderHook(() => useScheduleWindow({ from: "2026-09-14", to: "2026-09-14" }));
    expect(mergeJobs).not.toHaveBeenCalled();
  });

  it("reports truncation rather than quietly showing a partial day", () => {
    listItems = Array.from({ length: 400 }, (_, i) => ({ id: `j${i}` }));
    const { result } = renderHook(() => useScheduleWindow({ from: "2026-09-14", to: "2026-09-20" }));
    expect(result.current.truncated).toBe(true);
  });
});
