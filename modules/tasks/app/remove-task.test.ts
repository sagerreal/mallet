import { describe, it, expect, vi } from "vitest";
import { asTaskId, asOrgId } from "@mallet/shared/types";
import type { TaskRepository } from "../domain/task-repository";
import { RemoveTaskUseCase } from "./remove-task";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASK_ID = asTaskId("cccccccc-cccc-cccc-cccc-cccccccccccc");
const ORG_ID = asOrgId("dddddddd-dddd-dddd-dddd-dddddddddddd");
const FIXED_NOW = new Date("2026-07-09T12:00:00Z");

// Minimal in-memory fake — mirrors the style used in update-task.test.ts and
// set-task-done.test.ts; vi.fn() lets us assert call arguments precisely.
const makeRepo = (removeCount: number): TaskRepository => {
  return {
    findById: vi.fn(),
    save: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn().mockResolvedValue(removeCount),
  } as unknown as TaskRepository;
};

const makeClock = (date = FIXED_NOW) => ({ now: () => date });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RemoveTaskUseCase", () => {
  describe("not-found path — remove returns 0 rows affected", () => {
    it("returns a not_found error when remove reports 0 affected rows", async () => {
      const repo = makeRepo(0);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      const result = await uc.exec({ taskId: TASK_ID }, ORG_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("not_found");
        expect(result.error.message).toMatch(/task/i);
      }
    });

    it("still calls remove on the repository even when the row is missing", async () => {
      const repo = makeRepo(0);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      await uc.exec({ taskId: TASK_ID }, ORG_ID);

      expect(repo.remove).toHaveBeenCalledOnce();
    });

    it("passes the correct taskId and clock.now() timestamp to remove", async () => {
      const repo = makeRepo(0);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      await uc.exec({ taskId: TASK_ID }, ORG_ID);

      const [calledId, calledNow] = (repo.remove as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Date];
      expect(calledId).toBe(TASK_ID);
      expect(calledNow).toEqual(FIXED_NOW);
    });
  });

  describe("happy path — remove returns ≥1 rows affected", () => {
    it("returns ok with { ok: true } when remove reports 1 row affected", async () => {
      const repo = makeRepo(1);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      const result = await uc.exec({ taskId: TASK_ID }, ORG_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ ok: true });
      }
    });

    it("calls remove with the task id from the command", async () => {
      const repo = makeRepo(1);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      await uc.exec({ taskId: TASK_ID }, ORG_ID);

      expect(repo.remove).toHaveBeenCalledOnce();
      const [calledId] = (repo.remove as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Date];
      expect(calledId).toBe(TASK_ID);
    });

    it("passes clock.now() as the soft-delete timestamp to remove", async () => {
      const now = new Date("2026-07-09T15:30:00Z");
      const repo = makeRepo(1);
      const uc = new RemoveTaskUseCase(repo, makeClock(now));

      await uc.exec({ taskId: TASK_ID }, ORG_ID);

      const [, calledNow] = (repo.remove as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Date];
      expect(calledNow).toEqual(now);
    });

    it("resolves without throwing — logger.info branch is exercised (smoke)", async () => {
      const repo = makeRepo(1);
      const uc = new RemoveTaskUseCase(repo, makeClock());

      await expect(
        uc.exec({ taskId: TASK_ID }, ORG_ID),
      ).resolves.toMatchObject({ ok: true });
    });
  });
});
