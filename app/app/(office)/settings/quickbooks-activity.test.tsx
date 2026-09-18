// @vitest-environment jsdom
/**
 * The contract of this list is narrow and entirely about not hiding things: a failure is visible,
 * it says what to do, and the list itself failing to load is not mistaken for "all clear".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

type Query = { data?: unknown; isLoading: boolean; isError: boolean };
let query: Query;

vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { qbo: { syncActivity: { useQuery: () => query } } } },
}));

const { QuickbooksActivity } = await import("./quickbooks-activity");

const row = (over: Record<string, unknown> = {}) => ({
  entityType: "time_entry",
  malletId: "te-1",
  label: "Owen Duggan · Jul 25",
  status: "succeeded",
  qboId: "1073741824",
  problem: null,
  detail: null,
  attemptedAt: new Date("2026-07-25T20:00:00Z"),
  ...over,
});

const failed = (over: Record<string, unknown> = {}) =>
  row({
    status: "failed",
    qboId: null,
    problem: {
      code: "unmapped_employee",
      says: "This person isn't matched to anyone in QuickBooks.",
      fix: "Match them under Match your crew above, then send again.",
      retryable: true,
    },
    ...over,
  });

const loaded = (rows: unknown[], retryableCount = 0) => ({
  data: { rows, retryableCount },
  isLoading: false,
  isError: false,
});

beforeEach(() => {
  query = loaded([]);
});

describe("QuickbooksActivity", () => {
  it("explains the empty state rather than showing a blank box", () => {
    render(<QuickbooksActivity />);
    expect(screen.getByText(/Nothing has been sent yet/i)).toBeTruthy();
  });

  it("lists what went over, by name rather than by id", () => {
    query = loaded([row()]);
    render(<QuickbooksActivity />);
    expect(screen.getByText("1 sent to QuickBooks")).toBeTruthy();
    expect(screen.getByText("Owen Duggan · Jul 25")).toBeTruthy();
    expect(screen.queryByText(/te-1/)).toBeNull();
  });

  it("names the problem AND the next action for a failure", () => {
    query = loaded([failed()], 1);
    render(<QuickbooksActivity />);
    expect(screen.getByText("1 didn’t go over")).toBeTruthy();
    expect(screen.getByText(/isn't matched to anyone in QuickBooks/i)).toBeTruthy();
    expect(screen.getByText(/Match them under Match your crew/i)).toBeTruthy();
  });

  it("shows QuickBooks' own words as evidence under the explanation", () => {
    query = loaded([failed({ detail: "Invalid Reference Id" })], 1);
    render(<QuickbooksActivity />);
    expect(screen.getByText(/QuickBooks said: Invalid Reference Id/i)).toBeTruthy();
  });

  /**
   * The point of the whole screen. Thirty successes must not bury one failure, so failures render
   * in their own section ahead of the successes rather than interleaved by date.
   */
  it("puts failures ahead of successes instead of mixing them", () => {
    query = loaded([row(), row({ malletId: "te-2" }), failed({ malletId: "te-3" })], 1);
    const { container } = render(<QuickbooksActivity />);
    const headings = [...container.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(["1 didn’t go over", "2 sent to QuickBooks"]);
  });

  // Silence here would be indistinguishable from "nothing has gone wrong" — the exact confusion
  // this screen exists to end.
  it("says so when the list itself cannot load", () => {
    query = { data: undefined, isLoading: false, isError: true };
    render(<QuickbooksActivity />);
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn't load what's been sent/i);
  });

  it("says it is loading rather than claiming there is nothing", () => {
    query = { data: undefined, isLoading: true, isError: false };
    render(<QuickbooksActivity />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText(/Nothing has been sent yet/i)).toBeNull();
  });
});
