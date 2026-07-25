/**
 * Unit tests for RemoveTimeEntryUseCase.
 *
 * Covers:
 *  - not-found branch: repository.remove returns 0 → err(notFound(...))
 *  - happy path: repository.remove returns 1 → logger.info called, ok({ ok: true }) returned
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asTimeEntryId,
  asOrgId,
  asUserId,
  FixedClock,
  type TimeEntryId,
} from "@mallet/shared/types";
import { TimeEntry, type TimeEntryProps } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { RemoveTimeEntryUseCase, type RemoveTimeEntryCommand } from "./remove-time-entry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const ENTRY_ID = asTimeEntryId("11111111-1111-1111-1111-111111111111");
const USER_ID = asUserId("33333333-3333-3333-3333-333333333333");
const FIXED_NOW = new Date("2026-07-09T10:00:00Z");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseProps = (overrides: Partial<TimeEntryProps> = {}): TimeEntryProps => ({
  id: ENTRY_ID,
  orgId: ORG,
  techUserId: USER_ID,
  jobId: null,
  workDate: "2026-07-09",
  kind: "job",
  startTime: "08:00",
  endTime: "10:00",
  note: "",
  src: "manual",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: new Date("2026-07-09T08:00:00Z"),
  updatedAt: new Date("2026-07-09T08:00:00Z"),
  ...overrides,
});

const makeEntry = (overrides: Partial<TimeEntryProps> = {}): TimeEntry => {
  const result = TimeEntry.create(baseProps(overrides));
  if (!result.ok) throw new Error(`test setup: TimeEntry.create failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

// ---------------------------------------------------------------------------
// Minimal in-memory fake for TimeEntryRepository
// Reuses the same structure as the fake in update-time-entry.test.ts.
// ---------------------------------------------------------------------------

class FakeTimeEntryRepository implements TimeEntryRepository {
  private store = new Map<TimeEntryId, TimeEntry>();
  /** Calls recorded: [id, now] pairs */
  readonly removeCalls: Array<{ id: TimeEntryId; now: Date }> = [];

  seed(entry: TimeEntry): void {
    this.store.set(entry.props.id, entry);
  }

  async findById(id: TimeEntryId): Promise<TimeEntry | null> {
    return this.store.get(id) ?? null;
  }

  async save(entry: TimeEntry): Promise<void> {
    this.store.set(entry.props.id, entry);
  }

  async remove(id: TimeEntryId, now: Date): Promise<number> {
    this.removeCalls.push({ id, now });
    if (this.store.has(id)) {
      this.store.delete(id);
      return 1;
    }
    return 0;
  }

  // Remaining interface methods — not exercised by remove-time-entry
  async create(): Promise<TimeEntry> {
    throw new Error("not implemented in fake");
  }
  async list(): Promise<{ items: TimeEntry[]; nextCursor: null }> {
    return { items: [], nextCursor: null };
  }
  // Added with the unfinished-week guard: these fakes hold no rows, so nothing is unfinished.
  async unfinishedDates(): Promise<string[]> {
    return [];
  }

  async approveWeek(): Promise<number> {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RemoveTimeEntryUseCase — not-found branch", () => {
  it("returns a not_found error when the repository reports 0 rows removed", async () => {
    const repo = new FakeTimeEntryRepository();
    // Nothing seeded → remove() will return 0
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new RemoveTimeEntryUseCase(repo, clock);

    const cmd: RemoveTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_found");
  });

  it("passes entryId and clock.now() to repository.remove", async () => {
    const repo = new FakeTimeEntryRepository();
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new RemoveTimeEntryUseCase(repo, clock);

    await useCase.exec({ entryId: ENTRY_ID }, ORG);

    expect(repo.removeCalls).toHaveLength(1);
    expect(repo.removeCalls[0]?.id).toBe(ENTRY_ID);
    expect(repo.removeCalls[0]?.now.toISOString()).toBe(FIXED_NOW.toISOString());
  });
});

describe("RemoveTimeEntryUseCase — happy path", () => {
  it("returns ok({ ok: true }) when the repository removes 1 row", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry());
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new RemoveTimeEntryUseCase(repo, clock);

    const cmd: RemoveTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ ok: true });
  });

  it("calls repository.remove exactly once with the correct arguments", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry());
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new RemoveTimeEntryUseCase(repo, clock);

    await useCase.exec({ entryId: ENTRY_ID }, ORG);

    expect(repo.removeCalls).toHaveLength(1);
    expect(repo.removeCalls[0]?.id).toBe(ENTRY_ID);
    expect(repo.removeCalls[0]?.now.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it("logs timeEntry.removed with entryId and orgId on success", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry());
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new RemoveTimeEntryUseCase(repo, clock);

    // Spy on the logger imported inside the module under test
    const { logger } = await import("@mallet/shared/observability");
    const infoSpy = vi.spyOn(logger, "info");

    await useCase.exec({ entryId: ENTRY_ID }, ORG);

    expect(infoSpy).toHaveBeenCalledWith(
      { entryId: ENTRY_ID, orgId: ORG },
      "timeEntry.removed",
    );

    infoSpy.mockRestore();
  });
});
