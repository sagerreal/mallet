import { describe, it, expect, vi } from "vitest";
import { asTaskId, asOrgId, asLeadId, isOk } from "@mallet/shared/types";
import { Task, type TaskProps } from "../domain/task";
import type { TaskRepository } from "../domain/task-repository";
import { UpdateTaskUseCase } from "./update-task";

// ---------------------------------------------------------------------------
// Helpers — mirrors the style from task.test.ts
// ---------------------------------------------------------------------------

const TASK_ID = asTaskId("11111111-1111-1111-1111-111111111111");
const ORG_ID = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD_ID = asLeadId("33333333-3333-3333-3333-333333333333");
const NOW = new Date("2026-07-09T10:00:00Z");

const baseProps = (overrides: Partial<TaskProps> = {}): TaskProps => ({
  id: TASK_ID,
  orgId: ORG_ID,
  leadId: null,
  text: "Follow up with customer",
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

// Minimal in-memory fake — same approach the domain tests use (no library fakes).
const makeRepo = (task: Task | null = null): TaskRepository => {
  const saved: Task[] = [];
  return {
    findById: vi.fn().mockResolvedValue(task),
    save: vi.fn().mockImplementation(async (t: Task) => {
      saved.push(t);
    }),
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  } as unknown as TaskRepository;
};

const makeClock = (date = NOW) => ({ now: () => date });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdateTaskUseCase", () => {
  describe("when the task is not found", () => {
    it("returns a not_found error", async () => {
      const repo = makeRepo(null);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      const result = await useCase.exec({ taskId: TASK_ID, text: "New text" }, ORG_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
        expect(result.error.message).toMatch(/task not found/i);
      }
    });

    it("does not call save when the task is not found", async () => {
      const repo = makeRepo(null);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      await useCase.exec({ taskId: TASK_ID }, ORG_ID);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("when domain patch() fails", () => {
    it("returns the validation error without saving", async () => {
      const task = makeTask();
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      // Patch with an empty/blank string triggers Task.create's validation guard.
      const result = await useCase.exec({ taskId: TASK_ID, text: "   " }, ORG_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
      }
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe("happy path — task found and patch is valid", () => {
    it("returns ok with the updated task", async () => {
      const task = makeTask({ text: "old text" });
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      const result = await useCase.exec({ taskId: TASK_ID, text: "new text" }, ORG_ID);

      expect(result.ok).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.text).toBe("new text");
      }
    });

    it("persists the patched task via save", async () => {
      const task = makeTask({ text: "before" });
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      await useCase.exec({ taskId: TASK_ID, text: "after" }, ORG_ID);

      expect(repo.save).toHaveBeenCalledOnce();
      const [saved] = (repo.save as ReturnType<typeof vi.fn>).mock.calls[0] as [Task];
      expect(saved.props.text).toBe("after");
    });

    it("stamps updatedAt with clock.now()", async () => {
      const task = makeTask();
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock(NOW));

      const result = await useCase.exec({ taskId: TASK_ID, text: "anything" }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.updatedAt.toISOString()).toBe(NOW.toISOString());
      }
    });

    it("patches dueDate to null", async () => {
      const task = makeTask({ dueDate: "2026-07-15" });
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      const result = await useCase.exec({ taskId: TASK_ID, dueDate: null }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.dueDate).toBeNull();
      }
    });

    it("patches leadId", async () => {
      const task = makeTask({ leadId: null });
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      const result = await useCase.exec({ taskId: TASK_ID, leadId: LEAD_ID }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.leadId).toBe(LEAD_ID);
      }
    });

    it("keeps existing fields when the command omits them", async () => {
      const task = makeTask({ text: "keep me", dueDate: "2026-09-01" });
      const repo = makeRepo(task);
      const useCase = new UpdateTaskUseCase(repo, makeClock());

      // Only pass taskId — no other fields — which means no-change patch, still valid.
      const result = await useCase.exec({ taskId: TASK_ID }, ORG_ID);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.props.text).toBe("keep me");
        expect(result.value.props.dueDate).toBe("2026-09-01");
      }
    });
  });
});
