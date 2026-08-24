// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { listQuery, createMutate, openTask } = vi.hoisted(() => ({
  listQuery: vi.fn(),
  createMutate: vi.fn(),
  openTask: vi.fn(),
}));

// The board now issues ONE query PER COLUMN (batched into a single HTTP request by httpBatchLink),
// so the mock has to answer per status — a status-blind mock would put the same card in all four
// columns and hide exactly the bug this rewrite fixes.
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { agentTasks: { list: { invalidate: vi.fn() } } } }),
    v1: {
      agentTasks: {
        list: { useQuery: (input: { status: string }) => listQuery(input.status) },
        create: { useMutation: () => ({ mutate: createMutate, isPending: false }) },
      },
    },
  },
}));

import { ArtieBoard } from "./artie-board";

const task = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Follow up with the Hendersons",
  status: "needs_you",
  nextActionAt: null,
  nextActionNote: "I need your OK to send this",
  version: 2,
  updatedAt: "2026-08-20T17:00:00Z",
  createdAt: "2026-08-19T17:00:00Z",
  ...over,
});

const resolved = (items: unknown[], nextCursor: string | null = null) => ({
  data: { items, nextCursor },
  isLoading: false, isError: false, isFetched: true, isPlaceholderData: false,
  isRefetching: false, refetch: vi.fn(),
});

/** Answers each column's own query. Any status not named gets an empty page. */
const byStatus = (pages: Partial<Record<string, ReturnType<typeof resolved>>>) => (status: string) =>
  pages[status] ?? resolved([]);

describe("ArtieBoard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the four columns, Needs you first", () => {
    listQuery.mockImplementation(byStatus({}));
    render(<ArtieBoard onOpen={openTask} />);
    const heads = screen.getAllByTestId("artie-col-head").map((n) => n.textContent);
    expect(heads[0]).toContain("Needs you");
    expect(heads).toHaveLength(4);
  });

  it("puts a card in its column and shows what the agent said it needs", () => {
    listQuery.mockImplementation(byStatus({ needs_you: resolved([task()]) }));
    render(<ArtieBoard onOpen={openTask} />);
    const col = screen.getByTestId("artie-col-needs_you");
    expect(col.textContent).toContain("Follow up with the Hendersons");
    expect(col.textContent).toContain("I need your OK to send this");
  });

  it("counts from the same rows it renders", () => {
    listQuery.mockImplementation(
      byStatus({
        needs_you: resolved([task()]),
        working: resolved([task({ id: "b", status: "working" })]),
      }),
    );
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByTestId("artie-col-needs_you").textContent).toContain("1");
    expect(screen.getByTestId("artie-col-working").textContent).toContain("1");
  });

  it("opens a task when its card is activated", () => {
    listQuery.mockImplementation(byStatus({ needs_you: resolved([task()]) }));
    render(<ArtieBoard onOpen={openTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up with the Hendersons" }));
    expect(openTask).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("shows the first-run screen when the shop has never filed a task", () => {
    listQuery.mockImplementation(byStatus({}));
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByText("Nothing on Artie's list yet")).toBeTruthy();
  });

  it("shows a retry when ONE column failed — three good columns beside a silent empty one would lie", () => {
    const failed = {
      data: undefined, isLoading: false, isError: true, isFetched: true,
      isPlaceholderData: false, isRefetching: false, refetch: vi.fn(),
    };
    listQuery.mockImplementation((status: string) =>
      status === "needs_you" ? failed : resolved([task({ id: "x", status: "done" })]),
    );
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("shows the loader until EVERY column has landed, not a half-drawn board", () => {
    const pendingQuery = {
      data: undefined, isLoading: true, isError: false, isFetched: false,
      isPlaceholderData: false, isRefetching: false, refetch: vi.fn(),
    };
    listQuery.mockImplementation((status: string) =>
      status === "closed" ? pendingQuery : resolved([]),
    );
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.queryByTestId("artie-board")).toBeNull();
  });

  it("an open task is fetched under its OWN status, so a long Done column cannot bury it", () => {
    // The defect this replaces: one unfiltered `limit: 50` ordered by updated_at desc, with no
    // archive path, so 50 finished tasks pushed an untouched needs_you row off the board entirely.
    const finished = Array.from({ length: 25 }, (_, i) => task({ id: `d${i}`, status: "done" }));
    listQuery.mockImplementation(
      byStatus({ needs_you: resolved([task()]), done: resolved(finished, "cursor-there-is-more") }),
    );
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByTestId("artie-col-needs_you").textContent).toContain("Follow up with the Hendersons");
    // And the truncated column says it is a floor rather than reporting 25 as the total.
    expect(screen.getByTestId("artie-col-done").textContent).toContain("25+");
  });
});
