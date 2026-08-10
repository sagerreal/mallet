// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The rail columns' LOAD state.
 *
 * `hasData` exists because the row counts cannot answer the question a consumer is really asking.
 * A shop with nothing out on quotes has three answered reads and no rows; a board that reads that
 * as "no data" turns one failed refetch into a full-screen error over correctly-loaded columns.
 *
 * Three, not four: the accepted-quotes read went with the `won` rows it fed, which nothing rendered
 * once /pipeline was retired. It must not be back in the load composition either — an extra read
 * that never lands would hold `hasData` false over columns that are fully loaded.
 */

type Page = unknown[] | undefined;
let pages: Record<string, Page>;
/** Every status/view this hook actually asks the server for — asserted, not just mocked. */
let asked: string[];

const answer = (key: string) => {
  asked.push(key);
  return {
    data: pages[key] === undefined ? undefined : { items: pages[key] },
    isFetched: true,
    isError: false,
  };
};

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
    asked = [];
  });

  it("reports data in hand once every read has answered, empty or not", () => {
    const { result } = renderHook(() => useRailColumns());
    expect(result.current.out).toHaveLength(0);
    expect(result.current.hasData).toBe(true);
  });

  it("reports no data while any one of the three reads is in flight", () => {
    pages.sent = undefined;
    expect(renderHook(() => useRailColumns()).result.current.hasData).toBe(false);
  });

  it("does not fetch accepted quotes — nothing renders them", () => {
    renderHook(() => useRailColumns());
    expect(asked).not.toContain("accepted");
    expect(new Set(asked)).toEqual(new Set(["quoting", "draft", "sent"]));
  });
});
