// @vitest-environment jsdom
/**
 * features/money/use-money-query.search.test.ts
 *
 * The Money ledger is a UNION of two server queries: jobs ready to bill, and invoices. Search has
 * to reach BOTH, or the screen contradicts itself — the ready-to-bill chip counted only matching
 * jobs while the rows underneath it still listed every job in the worklist, so searching a
 * customer's name returned that customer's invoices next to somebody else's unbilled work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const jobsListInput = vi.fn();
const viewCountsInput = vi.fn();
const invoiceListInput = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      jobs: {
        list: { useQuery: (input: unknown) => (jobsListInput(input), { data: undefined }) },
        viewCounts: { useQuery: (input: unknown) => (viewCountsInput(input), { data: undefined }) },
      },
      invoicing: {
        list: {
          useInfiniteQuery: (input: unknown) => (invoiceListInput(input), { data: undefined }),
        },
        count: { useQuery: () => ({ data: undefined }) },
        viewCounts: { useQuery: () => ({ data: undefined }) },
      },
    },
  },
}));

// The hook debounces search by 250ms; these tests are about which INPUT is built, so the
// debounce is collapsed to the identity rather than driven with fake timers.
vi.mock("@/lib/use-debounced-value", () => ({ useDebouncedValue: (v: unknown) => v }));

import { useMoneyQuery } from "./use-money-query";

describe("useMoneyQuery — search reaches both halves of the ledger", () => {
  beforeEach(() => {
    jobsListInput.mockClear();
    viewCountsInput.mockClear();
    invoiceListInput.mockClear();
  });

  it("passes the search term to the ready-to-bill worklist, not just to its count", () => {
    renderHook(() => useMoneyQuery({ search: "novak", archived: false, statusFilter: "" }));

    expect(jobsListInput).toHaveBeenCalledWith(expect.objectContaining({ search: "novak" }));
    // The count already did this — it is why the chip and the rows disagreed.
    expect(viewCountsInput).toHaveBeenCalledWith(expect.objectContaining({ search: "novak" }));
  });

  it("sends no search key at all when the box is empty", () => {
    renderHook(() => useMoneyQuery({ search: "   ", archived: false, statusFilter: "" }));

    expect(jobsListInput.mock.calls[0]?.[0]).not.toHaveProperty("search");
  });
});
