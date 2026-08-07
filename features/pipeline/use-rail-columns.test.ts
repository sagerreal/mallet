// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The rail columns' LOAD state.
 *
 * `hasData` exists because the row counts cannot answer the question a consumer is really asking.
 * A shop with nothing out on quotes has four answered reads and no rows; a board that reads that
 * as "no data" turns one failed refetch into a full-screen error over correctly-loaded columns.
 */

type Page = unknown[] | undefined;
let pages: Record<string, Page>;

const answer = (key: string) => ({
  data: pages[key] === undefined ? undefined : { items: pages[key] },
  isFetched: true,
  isError: false,
});

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      customers: { list: { useQuery: (input: { view: string }) => answer(input.view) } },
      quoting: { list: { useQuery: (input: { status: string }) => answer(input.status) } },
    },
  },
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { leads: unknown[]; jobs: unknown[] }) => unknown) =>
    sel({ leads: [], jobs: [] }),
}));

import { useRailColumns } from "./use-rail-columns";

describe("useRailColumns load state", () => {
  beforeEach(() => {
    pages = { quoting: [], draft: [], sent: [], accepted: [] };
  });

  it("reports data in hand once every read has answered, empty or not", () => {
    const { result } = renderHook(() => useRailColumns());
    expect(result.current.out).toHaveLength(0);
    expect(result.current.hasData).toBe(true);
  });

  it("reports no data while any one of the four reads is in flight", () => {
    pages.accepted = undefined;
    expect(renderHook(() => useRailColumns()).result.current.hasData).toBe(false);
  });
});
