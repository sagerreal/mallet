/**
 * Unit tests for ApproveWeekUseCase.
 *
 * Covers:
 *  - happy path: approveWeek count is passed through and returned as { approved: count }
 *  - zero count: repository returns 0 (no matching draft entries), result still ok
 *  - count is forwarded exactly (delegates without mutation)
 */

import { describe, it, expect, vi } from "vitest";
import { asUserId, asOrgId, FixedClock, isOk } from "@mallet/shared/types";
import type { TimeEntryId, UserId, CursorPage, Paginated } from "@mallet/shared/types";
import type { TimeEntry } from "../domain/time-entry";
import type { TimeEntryFilter, TimeEntryRepository } from "../domain/time-entry-repository";
import { ApproveWeekUseCase, type ApproveWeekCommand } from "./approve-week";

// ---------------------------------------------------------------------------
// Minimal in-memory fake for TimeEntryRepository (matches the fake in sibling tests)
// ---------------------------------------------------------------------------

class FakeTimeEntryRepository implements TimeEntryRepository {
  private _approveWeekCount: number;
  readonly approveWeekCalls: Array<{ techUserId: UserId; dates: string[]; now: Date }> = [];

  constructor(approveWeekCount = 0) {
    this._approveWeekCount = approveWeekCount;
  }

  // Added with the unfinished-week guard: these fakes hold no rows, so nothing is unfinished.

  async unfinishedDates(): Promise<string[]> {

    return [];

  }


  async approveWeek(techUserId: UserId, dates: string[], now: Date): Promise<number> {
    this.approveWeekCalls.push({ techUserId, dates, now });
    return this._approveWeekCount;
  }

  // Remaining interface methods — not exercised by approve-week
  async create(): Promise<TimeEntry> {
    throw new Error("not implemented in fake");
  }
  async findById(): Promise<TimeEntry | null> {
    return null;
  }
  // Added with the clock state machine: approval never taps the clock, so it is always idle here.
  async findOpenForTech(): Promise<TimeEntry | null> {
    return null;
  }
  async count(): Promise<number> {
    return 0;
  }

  async list(): Promise<Paginated<TimeEntry>> {
    return { items: [], nextCursor: null };
  }
  async save(): Promise<void> {}
  async remove(): Promise<number> {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const TECH_USER_ID = asUserId("33333333-3333-3333-3333-333333333333");
const DATES = ["2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"];
const FIXED_NOW = new Date("2026-07-09T14:00:00Z");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApproveWeekUseCase — happy path", () => {
  it("returns ok with the approved count from the repository", async () => {
    const repo = new FakeTimeEntryRepository(5);
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new ApproveWeekUseCase(repo, clock);

    const cmd: ApproveWeekCommand = { techUserId: TECH_USER_ID, dates: DATES };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.approved).toBe(5);
  });

  it("delegates to repository.approveWeek with the correct arguments", async () => {
    const repo = new FakeTimeEntryRepository(3);
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new ApproveWeekUseCase(repo, clock);

    const cmd: ApproveWeekCommand = { techUserId: TECH_USER_ID, dates: DATES };
    await useCase.exec(cmd, ORG);

    expect(repo.approveWeekCalls).toHaveLength(1);
    const call = repo.approveWeekCalls[0]!;
    expect(call.techUserId).toBe(TECH_USER_ID);
    expect(call.dates).toEqual(DATES);
    expect(call.now.toISOString()).toBe(FIXED_NOW.toISOString());
  });

  it("returns ok with approved=0 when no draft entries matched", async () => {
    const repo = new FakeTimeEntryRepository(0);
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new ApproveWeekUseCase(repo, clock);

    const cmd: ApproveWeekCommand = { techUserId: TECH_USER_ID, dates: DATES };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.approved).toBe(0);
  });

  it("passes the count through unchanged (no transformation)", async () => {
    const arbitraryCount = 42;
    const repo = new FakeTimeEntryRepository(arbitraryCount);
    const clock = new FixedClock(FIXED_NOW);
    const useCase = new ApproveWeekUseCase(repo, clock);

    const cmd: ApproveWeekCommand = { techUserId: TECH_USER_ID, dates: ["2026-07-07"] };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.approved).toBe(arbitraryCount);
  });
});
