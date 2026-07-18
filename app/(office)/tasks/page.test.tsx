// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Task } from "@/lib/store/types";

let tasks: Task[] = [];
let queryState = { isFetched: true, isError: false };

vi.mock("@/lib/store/app-store", () => ({
  useTasks: () => tasks,
  useLeads: () => [],
  useAppStore: (sel: (s: { addTask: () => void; toggleTask: () => void }) => unknown) =>
    sel({ addTask: vi.fn(), toggleTask: vi.fn() }),
  useOpenModal: () => vi.fn(),
}));
vi.mock("@/lib/trpc/client", () => ({
  api: { v1: { tasks: { list: { useQuery: () => queryState } } } },
}));

import TasksPage from "./page";

const task = (over: Partial<Task> = {}): Task =>
  ({ id: "t1", t: "Do the thing", due: null, leadId: null, done: false, ...over } as Task);

describe("TasksPage — first-run vs caught-up empty states", () => {
  beforeEach(() => {
    tasks = [];
    queryState = { isFetched: true, isError: false };
    vi.clearAllMocks();
  });

  it("shows the first-run message when the shop has never had a task", () => {
    render(<TasksPage />);
    expect(screen.getByText("No tasks yet")).toBeTruthy();
    expect(screen.queryByText("You're all caught up")).toBeNull();
  });

  it("shows 'all caught up' (not first-run) when tasks exist but all are done", () => {
    tasks = [task({ done: true })];
    render(<TasksPage />);
    expect(screen.getByText("You're all caught up")).toBeTruthy();
    expect(screen.queryByText("No tasks yet")).toBeNull();
  });

  it("does not flash the first-run message while tasks are still loading", () => {
    queryState = { isFetched: false, isError: false };
    render(<TasksPage />);
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });

  it("shows the list (neither empty message) when there are open tasks", () => {
    tasks = [task({ done: false })];
    render(<TasksPage />);
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(screen.queryByText("You're all caught up")).toBeNull();
    expect(screen.getByText("Do the thing")).toBeTruthy();
  });
});
