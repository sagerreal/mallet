import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asTaskId,
  type CursorPage,
  type Paginated,
  type LeadId,
  type TaskId,
} from "@mallet/shared/types";
import { Task, type TaskProps } from "../domain/task";
import type { TaskRepository, TaskFilter } from "../domain/task-repository";
import { ListTasksUseCase, type ListTasksQuery } from "./list-tasks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_ID = asOrgId("11111111-1111-1111-1111-111111111111");
const LEAD_ID: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");

const makeTask = (overrides: Partial<TaskProps> = {}): Task => {
  const props: TaskProps = {
    id: asTaskId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    orgId: ORG_ID,
    leadId: null,
    text: "Default task text",
    dueDate: null,
    done: false,
    createdAt: new Date("2026-07-09T00:00:00Z"),
    updatedAt: new Date("2026-07-09T00:00:00Z"),
    ...overrides,
  };
  const result = Task.create(props);
  if (!result.ok) throw new Error(`test setup: ${JSON.stringify(result.error)}`);
  return result.value;
};

// ---------------------------------------------------------------------------
// Configurable in-memory TaskRepository fake
// ---------------------------------------------------------------------------

interface FakeListResult {
  items: Task[];
  nextCursor: string | null;
}

const makeRepo = (
  result: FakeListResult = { items: [], nextCursor: null },
): TaskRepository & {
  lastPage: CursorPage | undefined;
  lastFilter: TaskFilter | undefined;
} => {
  const repo = {
    lastPage: undefined as CursorPage | undefined,
    lastFilter: undefined as TaskFilter | undefined,

    async list(page: CursorPage, filter?: TaskFilter): Promise<Paginated<Task>> {
      repo.lastPage = page;
      repo.lastFilter = filter;
      return { items: result.items, nextCursor: result.nextCursor };
    },
    async create(): Promise<Task> {
      throw new Error("unexpected create");
    },
    async findById(_id: TaskId): Promise<Task | null> {
      return null;
    },
    async save(): Promise<void> {
      throw new Error("unexpected save");
    },
    async remove(): Promise<number> {
      return 0;
    },
  };
  return repo;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ListTasksUseCase", () => {
  describe("delegation — passes query parameters to repository", () => {
    it("delegates the page to repo.list", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);
      const page: CursorPage = { limit: 10, cursor: null };

      await uc.exec({ page });

      expect(repo.lastPage).toEqual({ limit: 10, cursor: null });
    });

    it("delegates the cursor to repo.list when one is provided", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);
      const cursor = "dGVzdC1jdXJzb3I=";
      const page: CursorPage = { limit: 25, cursor };

      await uc.exec({ page });

      expect(repo.lastPage?.cursor).toBe(cursor);
    });

    it("passes the filter through to repo.list when provided", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);
      const filter: TaskFilter = { done: false, leadId: LEAD_ID };

      await uc.exec({ page: { limit: 25, cursor: null }, filter });

      expect(repo.lastFilter).toEqual({ done: false, leadId: LEAD_ID });
    });

    it("passes undefined as filter when none is provided", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);

      await uc.exec({ page: { limit: 25, cursor: null } });

      expect(repo.lastFilter).toBeUndefined();
    });
  });

  describe("return value — forwards repo.list result unchanged", () => {
    it("returns an empty page when the repository returns no items", async () => {
      const repo = makeRepo({ items: [], nextCursor: null });
      const uc = new ListTasksUseCase(repo);

      const result = await uc.exec({ page: { limit: 25, cursor: null } });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("returns the items exactly as the repository provides them", async () => {
      const task1 = makeTask({
        id: asTaskId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        text: "First task",
      });
      const task2 = makeTask({
        id: asTaskId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        text: "Second task",
      });
      const repo = makeRepo({ items: [task1, task2], nextCursor: null });
      const uc = new ListTasksUseCase(repo);

      const result = await uc.exec({ page: { limit: 25, cursor: null } });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toBe(task1);
      expect(result.items[1]).toBe(task2);
    });

    it("forwards a non-null nextCursor from the repository", async () => {
      const task = makeTask();
      const cursor = "bmV4dC1jdXJzb3I=";
      const repo = makeRepo({ items: [task], nextCursor: cursor });
      const uc = new ListTasksUseCase(repo);

      const result = await uc.exec({ page: { limit: 1, cursor: null } });

      expect(result.nextCursor).toBe(cursor);
    });

    it("returns null nextCursor when the repository signals no further pages", async () => {
      const task = makeTask();
      const repo = makeRepo({ items: [task], nextCursor: null });
      const uc = new ListTasksUseCase(repo);

      const result = await uc.exec({ page: { limit: 25, cursor: null } });

      expect(result.nextCursor).toBeNull();
    });
  });

  describe("filter combinations", () => {
    it("passes a done-only filter to the repository", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);
      const filter: TaskFilter = { done: true };

      await uc.exec({ page: { limit: 25, cursor: null }, filter });

      expect(repo.lastFilter).toEqual({ done: true });
    });

    it("passes a leadId-only filter to the repository", async () => {
      const repo = makeRepo();
      const uc = new ListTasksUseCase(repo);
      const filter: TaskFilter = { leadId: LEAD_ID };

      await uc.exec({ page: { limit: 25, cursor: null }, filter });

      expect(repo.lastFilter).toEqual({ leadId: LEAD_ID });
    });
  });
});
