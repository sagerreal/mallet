/**
 * Unit tests for ListTimeEntriesUseCase.
 *
 * Covers:
 *  - Delegation: exec() forwards filter and page exactly as-is to repository.list
 *  - Return value: the paginated result from the repository is returned unchanged
 *  - Empty result: empty items + null nextCursor is returned faithfully
 *  - Non-null cursor: nextCursor from the repo is propagated
 *  - Filter fields: techUserId, fromDate, toDate are all forwarded
 */

import { describe, it, expect } from "vitest";
import {
  asUserId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { TimeEntry, type TimeEntryProps } from "../domain/time-entry";
import type { TimeEntryRepository, TimeEntryFilter } from "../domain/time-entry-repository";
import type { TimeEntryId } from "@mallet/shared/types";
import {
  asTimeEntryId,
  asOrgId,
} from "@mallet/shared/types";
import { ListTimeEntriesUseCase, type ListTimeEntriesQuery } from "./list-time-entries";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const USER_ID = asUserId("33333333-3333-3333-3333-333333333333");
const ENTRY_ID = asTimeEntryId("11111111-1111-1111-1111-111111111111");

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
// Tracks list() calls so we can assert delegation.
// ---------------------------------------------------------------------------

class FakeTimeEntryRepository implements TimeEntryRepository {
  /** Configured return value for list() */
  private listResult: Paginated<TimeEntry> = { items: [], nextCursor: null };
  /** Recorded calls: [filter, page] pairs */
  readonly listCalls: Array<{ filter: TimeEntryFilter; page: CursorPage }> = [];

  setListResult(result: Paginated<TimeEntry>): void {
    this.listResult = result;
  }

  countCalls: TimeEntryFilter[] = [];
  countResult = 0;

  async count(filter: TimeEntryFilter): Promise<number> {
    this.countCalls.push(filter);
    return this.countResult;
  }

  async list(filter: TimeEntryFilter, page: CursorPage): Promise<Paginated<TimeEntry>> {
    this.listCalls.push({ filter, page });
    return this.listResult;
  }

  // Remaining interface methods — not exercised by list-time-entries
  async create(): Promise<TimeEntry> {
    throw new Error("not implemented in fake");
  }
  async findById(): Promise<TimeEntry | null> {
    return null;
  }
  async save(): Promise<void> {
    // no-op
  }
  async remove(): Promise<number> {
    return 0;
  }
  // Added with the unfinished-week guard: these fakes hold no rows, so nothing is unfinished.
  async unfinishedDates(): Promise<string[]> {
    return [];
  }

  async approveWeek(): Promise<number> {
    return 0;
  }

  // Added with the clock state machine: the use-cases under test never tap the clock, so it
  // is always idle here.
  async findOpenForTech(): Promise<TimeEntry | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ListTimeEntriesUseCase — delegation", () => {
  it("calls repository.list exactly once", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const query: ListTimeEntriesQuery = {
      filter: {},
      page: { limit: 25, cursor: null },
    };

    await useCase.exec(query);

    expect(repo.listCalls).toHaveLength(1);
  });

  it("passes the filter from the query to repository.list unchanged", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const filter: TimeEntryFilter = {
      techUserId: USER_ID,
      fromDate: "2026-07-01",
      toDate: "2026-07-09",
    };
    const query: ListTimeEntriesQuery = {
      filter,
      page: { limit: 10, cursor: null },
    };

    await useCase.exec(query);

    expect(repo.listCalls[0]?.filter).toBe(filter);
  });

  it("passes the page from the query to repository.list unchanged", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const page: CursorPage = { limit: 50, cursor: "some-cursor-token" };
    const query: ListTimeEntriesQuery = {
      filter: {},
      page,
    };

    await useCase.exec(query);

    expect(repo.listCalls[0]?.page).toBe(page);
  });
});

describe("ListTimeEntriesUseCase — return value", () => {
  it("returns the empty paginated result from the repository as-is", async () => {
    const repo = new FakeTimeEntryRepository();
    // default listResult is { items: [], nextCursor: null }
    const useCase = new ListTimeEntriesUseCase(repo);

    const query: ListTimeEntriesQuery = {
      filter: {},
      page: { limit: 25, cursor: null },
    };

    const result = await useCase.exec(query);

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns items from the repository without modification", async () => {
    const repo = new FakeTimeEntryRepository();
    const entry = makeEntry();
    repo.setListResult({ items: [entry], nextCursor: null });
    const useCase = new ListTimeEntriesUseCase(repo);

    const query: ListTimeEntriesQuery = {
      filter: {},
      page: { limit: 25, cursor: null },
    };

    const result = await useCase.exec(query);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toBe(entry);
  });

  it("propagates a non-null nextCursor from the repository", async () => {
    const repo = new FakeTimeEntryRepository();
    const entry = makeEntry();
    const nextCursor = "dGVzdC1jdXJzb3I";
    repo.setListResult({ items: [entry], nextCursor });
    const useCase = new ListTimeEntriesUseCase(repo);

    const query: ListTimeEntriesQuery = {
      filter: {},
      page: { limit: 1, cursor: null },
    };

    const result = await useCase.exec(query);

    expect(result.nextCursor).toBe(nextCursor);
  });

  it("returns multiple items in the same order provided by the repository", async () => {
    const repo = new FakeTimeEntryRepository();
    const entry1 = makeEntry({ workDate: "2026-07-01" });
    const entry2 = makeEntry({ workDate: "2026-07-02" });
    repo.setListResult({ items: [entry1, entry2], nextCursor: null });
    const useCase = new ListTimeEntriesUseCase(repo);

    const query: ListTimeEntriesQuery = {
      filter: {},
      page: { limit: 25, cursor: null },
    };

    const result = await useCase.exec(query);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toBe(entry1);
    expect(result.items[1]).toBe(entry2);
  });
});

describe("ListTimeEntriesUseCase — filter field forwarding", () => {
  it("forwards only techUserId when fromDate and toDate are absent", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const filter: TimeEntryFilter = { techUserId: USER_ID };
    await useCase.exec({ filter, page: { limit: 25, cursor: null } });

    expect(repo.listCalls[0]?.filter.techUserId).toBe(USER_ID);
    expect(repo.listCalls[0]?.filter.fromDate).toBeUndefined();
    expect(repo.listCalls[0]?.filter.toDate).toBeUndefined();
  });

  it("forwards fromDate and toDate without techUserId", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const filter: TimeEntryFilter = { fromDate: "2026-07-01", toDate: "2026-07-07" };
    await useCase.exec({ filter, page: { limit: 25, cursor: null } });

    expect(repo.listCalls[0]?.filter.fromDate).toBe("2026-07-01");
    expect(repo.listCalls[0]?.filter.toDate).toBe("2026-07-07");
    expect(repo.listCalls[0]?.filter.techUserId).toBeUndefined();
  });

  it("forwards an empty filter object without modification", async () => {
    const repo = new FakeTimeEntryRepository();
    const useCase = new ListTimeEntriesUseCase(repo);

    const filter: TimeEntryFilter = {};
    await useCase.exec({ filter, page: { limit: 25, cursor: null } });

    expect(repo.listCalls[0]?.filter).toStrictEqual({});
  });
});
