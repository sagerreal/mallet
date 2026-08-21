// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { listQuery, createMutate, openTask } = vi.hoisted(() => ({
  listQuery: vi.fn(),
  createMutate: vi.fn(),
  openTask: vi.fn(),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { agentTasks: { list: { invalidate: vi.fn() } } } }),
    v1: {
      agentTasks: {
        list: { useQuery: () => listQuery() },
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

const resolved = (items: unknown[]) => ({
  data: { items, nextCursor: null },
  isLoading: false, isError: false, isFetched: true, isPlaceholderData: false,
  isRefetching: false, refetch: vi.fn(),
});

describe("ArtieBoard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the four columns, Needs you first", () => {
    listQuery.mockReturnValue(resolved([]));
    render(<ArtieBoard onOpen={openTask} />);
    const heads = screen.getAllByTestId("artie-col-head").map((n) => n.textContent);
    expect(heads[0]).toContain("Needs you");
    expect(heads).toHaveLength(4);
  });

  it("puts a card in its column and shows what the agent said it needs", () => {
    listQuery.mockReturnValue(resolved([task()]));
    render(<ArtieBoard onOpen={openTask} />);
    const col = screen.getByTestId("artie-col-needs_you");
    expect(col.textContent).toContain("Follow up with the Hendersons");
    expect(col.textContent).toContain("I need your OK to send this");
  });

  it("counts from the same rows it renders", () => {
    listQuery.mockReturnValue(resolved([task(), task({ id: "b", status: "working" })]));
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByTestId("artie-col-needs_you").textContent).toContain("1");
    expect(screen.getByTestId("artie-col-working").textContent).toContain("1");
  });

  it("opens a task when its card is activated", () => {
    listQuery.mockReturnValue(resolved([task()]));
    render(<ArtieBoard onOpen={openTask} />);
    fireEvent.click(screen.getByRole("button", { name: "Follow up with the Hendersons" }));
    expect(openTask).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("shows the first-run screen when the shop has never filed a task", () => {
    listQuery.mockReturnValue(resolved([]));
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByText("Nothing on Artie's list yet")).toBeTruthy();
  });

  it("shows a retry when the list failed to load", () => {
    listQuery.mockReturnValue({
      data: undefined, isLoading: false, isError: true, isFetched: true,
      isPlaceholderData: false, isRefetching: false, refetch: vi.fn(),
    });
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("shows the loader on a cold load, not an empty board", () => {
    listQuery.mockReturnValue({
      data: undefined, isLoading: true, isError: false, isFetched: false,
      isPlaceholderData: false, isRefetching: false, refetch: vi.fn(),
    });
    render(<ArtieBoard onOpen={openTask} />);
    expect(screen.queryByTestId("artie-board")).toBeNull();
  });
});
