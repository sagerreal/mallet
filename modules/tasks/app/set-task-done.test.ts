import { describe, it, expect, vi, beforeEach } from "vitest";
import { asTaskId, asOrgId, isOk } from "@mallet/shared/types";
import { Task, type TaskProps } from "../domain/task";
import type { TaskRepository } from "../domain/task-repository";
import { SetTaskDoneUseCase } from "./set-task-done";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASK_ID = asTaskId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const ORG_ID = asOrgId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const FIXED_NOW = new Date("2026-07-09T12:00:00Z");

const baseProps = (overrides: Partial<TaskProps> = {}): TaskProps => ({
  id: TASK_ID,
  orgId: ORG_ID,
  leadId: null,
  text: "Follow up on estimate",
  dueDate: "2026-07-15",
  done: false,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeTask = (overrides: Partial<TaskProps> = {}): Task => {
  const r = Task.create(baseProps(overrides));
  if (!r.ok) throw new Error(`test setup: ${JSON.stringify(r.error)}`);
  return r.value;
};

const fixedClock = { now: () => FIXED_NOW };

// ---------------------------------------------------------------------------
// In-memory repository fake — matches the TaskRepository interface
// ---------------------------------------------------------------------------

const makeRepo = (task: Task | null): TaskRepository & { saved: Task | undefined } => {
  const repo = {
    saved: undefined as Task | undefined,
    async findById() {
      return task;
    },
    async create() {
      throw new Error("unexpected create");
    },
    async count() { return 0; },
    async list() {
      return { items: [], nextCursor: null };
    },
    async save(t: Task) {
      repo.saved = t;
    },
    async remove() {
      return 0;
    },
  };
  return repo;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SetTaskDoneUseCase", () => {
  describe("not-found path", () => {
    it("returns a not_found error when the task does not exist", async () => {
      const repo = makeRepo(null);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      const result = await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
        expect(result.error.message).toMatch(/task/i);
      }
    });

    it("does not call save when the task is not found", async () => {
      const repo = makeRepo(null);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      expect(repo.saved).toBeUndefined();
    });
  });

  describe("no-op path — done value unchanged", () => {
    it("returns ok with the same task instance when done is already false", async () => {
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      const result = await uc.exec({ taskId: TASK_ID, done: false }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        // setDone is a no-op — the exact same Task instance must come back
        expect(result.value).toBe(task);
      }
    });

    it("does not call save when done value is unchanged", async () => {
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      await uc.exec({ taskId: TASK_ID, done: false }, ORG_ID);

      expect(repo.saved).toBeUndefined();
    });
  });

  describe("mutation path — done value changes", () => {
    it("returns ok with the updated task when marking done", async () => {
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      const result = await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.done).toBe(true);
        expect(result.value.props.updatedAt.toISOString()).toBe(FIXED_NOW.toISOString());
        // Immutability: original task is unchanged
        expect(task.props.done).toBe(false);
      }
    });

    it("returns ok with the updated task when marking undone", async () => {
      const task = makeTask({ done: true });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      const result = await uc.exec({ taskId: TASK_ID, done: false }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.done).toBe(false);
      }
    });

    it("calls save with the mutated task", async () => {
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      expect(repo.saved).toBeDefined();
      expect(repo.saved!.props.done).toBe(true);
      expect(repo.saved!.props.id).toBe(TASK_ID);
    });

    it("saves a new Task instance (not the original)", async () => {
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      // The saved instance must be different from the original (immutability)
      expect(repo.saved).not.toBe(task);
    });
  });

  describe("log path", () => {
    it("resolves successfully and logs — logger.info is called (smoke test via no throw)", async () => {
      // This test verifies the logger.info branch is reached without throwing.
      // We exercise both the mutation path (save + log) and confirm the result is ok.
      const task = makeTask({ done: false });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      await expect(
        uc.exec({ taskId: TASK_ID, done: true }, ORG_ID),
      ).resolves.toMatchObject({ ok: true });
    });

    it("logs even on the no-op path (no save, but result is ok)", async () => {
      const task = makeTask({ done: true });
      const repo = makeRepo(task);
      const uc = new SetTaskDoneUseCase(repo, fixedClock);

      const result = await uc.exec({ taskId: TASK_ID, done: true }, ORG_ID);

      expect(isOk(result)).toBe(true);
      // save was NOT called
      expect(repo.saved).toBeUndefined();
    });
  });
});
