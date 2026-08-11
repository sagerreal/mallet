/**
 * Unit tests for UpdateTimeEntryUseCase.
 *
 * Covers:
 *  - not-found branch (findById returns null)
 *  - domain patch() failure propagated without saving
 *  - all 8 optional-field undefined-vs-provided branches (jobId, workDate, kind, startTime,
 *    endTime, note, src, running each fall back to entry.props when cmd field is undefined)
 *  - happy path: save called with patched entry, ok result returned
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asTimeEntryId,
  asOrgId,
  asUserId,
  asJobId,
  FixedClock,
  isOk,
  type TimeEntryId,
} from "@mallet/shared/types";
import { TimeEntry, type TimeEntryProps } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { UpdateTimeEntryUseCase, type UpdateTimeEntryCommand } from "./update-time-entry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const ENTRY_ID = asTimeEntryId("11111111-1111-1111-1111-111111111111");
const USER_ID = asUserId("33333333-3333-3333-3333-333333333333");
const JOB_ID = asJobId("44444444-4444-4444-4444-444444444444");

const baseProps = (overrides: Partial<TimeEntryProps> = {}): TimeEntryProps => ({
  id: ENTRY_ID,
  orgId: ORG,
  techUserId: USER_ID,
  jobId: null,
  workDate: "2026-07-07",
  kind: "job",
  startTime: "08:00",
  endTime: "10:00",
  note: "",
  src: "manual",
  status: "draft",
  running: false,
  approvedAt: null,
  createdAt: new Date("2026-07-07T08:00:00Z"),
  updatedAt: new Date("2026-07-07T08:00:00Z"),
  ...overrides,
});

const makeEntry = (overrides: Partial<TimeEntryProps> = {}): TimeEntry => {
  const result = TimeEntry.create(baseProps(overrides));
  if (!result.ok) throw new Error(`test setup: TimeEntry.create failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

// ---------------------------------------------------------------------------
// Minimal in-memory fake for TimeEntryRepository
// ---------------------------------------------------------------------------

class FakeTimeEntryRepository implements TimeEntryRepository {
  private store = new Map<TimeEntryId, TimeEntry>();
  readonly saveCalls: TimeEntry[] = [];

  seed(entry: TimeEntry): void {
    this.store.set(entry.props.id, entry);
  }

  async findById(id: TimeEntryId): Promise<TimeEntry | null> {
    return this.store.get(id) ?? null;
  }

  async save(entry: TimeEntry): Promise<void> {
    this.store.set(entry.props.id, entry);
    this.saveCalls.push(entry);
  }

  // Remaining interface methods — not exercised by update-time-entry
  async create(): Promise<TimeEntry> {
    throw new Error("not implemented in fake");
  }
  async count(): Promise<number> {
    return 0;
  }

  // The overlap gate lists the target day through the same store seed() fills, filtered the way
  // the real repository filters — so the entry being edited is naturally in the result and the
  // gate's self-exclusion is actually exercised.
  async list(
    filter: Parameters<TimeEntryRepository["list"]>[0],
  ): Promise<{ items: TimeEntry[]; nextCursor: null }> {
    const items = [...this.store.values()].filter(
      (e) =>
        (filter.techUserId === undefined || e.props.techUserId === filter.techUserId) &&
        (filter.fromDate === undefined || e.props.workDate >= filter.fromDate) &&
        (filter.toDate === undefined || e.props.workDate <= filter.toDate),
    );
    return { items, nextCursor: null };
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

describe("UpdateTimeEntryUseCase — not-found branch", () => {
  it("returns a not_found error when the entry does not exist", async () => {
    const repo = new FakeTimeEntryRepository();
    const clock = new FixedClock(new Date("2026-07-08T10:00:00Z"));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_found");
    expect(repo.saveCalls).toHaveLength(0);
  });
});

describe("UpdateTimeEntryUseCase — patch() failure branch", () => {
  it("returns the domain error without saving when patch() fails", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry({ startTime: "08:00", endTime: "10:00" }));
    const clock = new FixedClock(new Date("2026-07-08T10:00:00Z"));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    // Patching endTime to before startTime triggers a domain validation error
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, endTime: "07:00" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    // No save must have been called
    expect(repo.saveCalls).toHaveLength(0);
  });

  it("returns a validation error when an invalid kind is provided", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry());
    const clock = new FixedClock(new Date("2026-07-08T10:00:00Z"));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, kind: "nope" as "job" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(repo.saveCalls).toHaveLength(0);
  });
});

describe("UpdateTimeEntryUseCase — optional-field undefined-vs-provided branches", () => {
  let repo: FakeTimeEntryRepository;
  let clock: FixedClock;
  let useCase: UpdateTimeEntryUseCase;

  beforeEach(() => {
    repo = new FakeTimeEntryRepository();
    clock = new FixedClock(new Date("2026-07-08T12:00:00Z"));
    useCase = new UpdateTimeEntryUseCase(repo, clock);
  });

  it("falls back to entry.props.jobId when cmd.jobId is undefined", async () => {
    repo.seed(makeEntry({ jobId: JOB_ID }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID }; // jobId not set
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.jobId).toBe(JOB_ID);
  });

  it("uses cmd.jobId when provided (overrides entry.props.jobId)", async () => {
    repo.seed(makeEntry({ jobId: null }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, jobId: JOB_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.jobId).toBe(JOB_ID);
  });

  it("falls back to entry.props.workDate when cmd.workDate is undefined", async () => {
    repo.seed(makeEntry({ workDate: "2026-06-15" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.workDate).toBe("2026-06-15");
  });

  it("uses cmd.workDate when provided", async () => {
    repo.seed(makeEntry({ workDate: "2026-06-15" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, workDate: "2026-07-01" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.workDate).toBe("2026-07-01");
  });

  it("falls back to entry.props.kind when cmd.kind is undefined", async () => {
    repo.seed(makeEntry({ kind: "travel" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.kind).toBe("travel");
  });

  it("uses cmd.kind when provided", async () => {
    repo.seed(makeEntry({ kind: "job" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, kind: "break" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.kind).toBe("break");
  });

  it("falls back to entry.props.startTime when cmd.startTime is undefined", async () => {
    repo.seed(makeEntry({ startTime: "09:00", endTime: "11:00" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.startTime).toBe("09:00");
  });

  it("uses cmd.startTime when provided", async () => {
    repo.seed(makeEntry({ startTime: "08:00", endTime: "10:00" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, startTime: "09:00" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.startTime).toBe("09:00");
  });

  it("falls back to entry.props.endTime when cmd.endTime is undefined", async () => {
    repo.seed(makeEntry({ startTime: "08:00", endTime: "10:00" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.endTime).toBe("10:00");
  });

  it("uses cmd.endTime when provided (including null for running timer)", async () => {
    repo.seed(makeEntry({ startTime: "08:00", endTime: "10:00" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, endTime: null };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.endTime).toBeNull();
  });

  it("falls back to entry.props.note when cmd.note is undefined", async () => {
    repo.seed(makeEntry({ note: "original note" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.note).toBe("original note");
  });

  it("uses cmd.note when provided", async () => {
    repo.seed(makeEntry({ note: "old note" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, note: "new note" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.note).toBe("new note");
  });

  it("falls back to entry.props.src when cmd.src is undefined", async () => {
    repo.seed(makeEntry({ src: "clock" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.src).toBe("clock");
  });

  it("uses cmd.src when provided", async () => {
    repo.seed(makeEntry({ src: "manual" }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, src: "timer" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.src).toBe("timer");
  });

  it("falls back to entry.props.running when cmd.running is undefined", async () => {
    repo.seed(makeEntry({ running: true, endTime: null }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.running).toBe(true);
  });

  it("uses cmd.running when provided", async () => {
    repo.seed(makeEntry({ running: false }));
    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, running: true, endTime: null };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.running).toBe(true);
  });
});

describe("UpdateTimeEntryUseCase — happy path (save + log)", () => {
  it("saves the patched entry and returns ok with the updated TimeEntry", async () => {
    const repo = new FakeTimeEntryRepository();
    const fixedNow = new Date("2026-07-08T14:00:00Z");
    const clock = new FixedClock(fixedNow);
    repo.seed(makeEntry({ note: "before" }));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, note: "after" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Correct field patched
    expect(result.value.props.note).toBe("after");

    // updatedAt bumped to clock.now()
    expect(result.value.props.updatedAt.toISOString()).toBe(fixedNow.toISOString());

    // save was called exactly once with the patched entry
    expect(repo.saveCalls).toHaveLength(1);
    expect(repo.saveCalls[0]?.props.note).toBe("after");

    // Original entry ID preserved
    expect(result.value.props.id).toBe(ENTRY_ID);
  });

  it("does not mutate the original entry (immutability)", async () => {
    const repo = new FakeTimeEntryRepository();
    const original = makeEntry({ note: "unchanged", kind: "job" });
    repo.seed(original);
    const clock = new FixedClock(new Date("2026-07-08T14:00:00Z"));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    const cmd: UpdateTimeEntryCommand = { entryId: ENTRY_ID, note: "changed", kind: "travel" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    // The original in-memory object must be unchanged
    expect(original.props.note).toBe("unchanged");
    expect(original.props.kind).toBe("job");
  });

  it("returns a TimeEntry instance (not a plain object) on success", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry());
    const clock = new FixedClock(new Date("2026-07-08T14:00:00Z"));
    const useCase = new UpdateTimeEntryUseCase(repo, clock);

    const result = await useCase.exec({ entryId: ENTRY_ID }, ORG);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toBeInstanceOf(TimeEntry);
  });
});

// Approved means LOCKED. Without this guard an approved entry could be rewritten while approvedAt
// stayed set — the record would claim the shop signed off on hours it never saw, and once already
// pushed, QuickBooks would hold different numbers than Mallet displays. Reopen is the only way back.
describe("an approved entry cannot be edited", () => {
  const approvedEntry = () => {
    const res = TimeEntry.create({
      id: asTimeEntryId("22222222-2222-2222-2222-222222222222"),
      orgId: asOrgId("33333333-3333-3333-3333-333333333333"),
      techUserId: asUserId("44444444-4444-4444-4444-444444444444"),
      jobId: null,
      workDate: "2026-07-21",
      kind: "job",
      startTime: "08:00",
      endTime: "16:00",
      note: "",
      src: "manual",
      status: "approved",
      running: false,
      approvedAt: new Date("2026-07-22T10:00:00.000Z"),
      createdAt: new Date("2026-07-21T08:00:00.000Z"),
      updatedAt: new Date("2026-07-21T08:00:00.000Z"),
    });
    if (!res.ok) throw new Error("fixture rejected");
    return res.value;
  };

  const runUpdate = async (patch: Record<string, unknown>) => {
    const entry = approvedEntry();
    const save = vi.fn();
    const repo = {
      findById: vi.fn().mockResolvedValue(entry),
      save,
    } as unknown as TimeEntryRepository;
    const res = await new UpdateTimeEntryUseCase(
      repo,
      new FixedClock(new Date("2026-07-24T12:00:00.000Z")),
    ).exec({ entryId: entry.props.id, ...patch } as never, "org-1");
    return { res, save };
  };

  it("refuses the edit", async () => {
    const { res } = await runUpdate({ startTime: "07:00" });
    expect(res.ok).toBe(false);
  });

  it("reports a conflict, so the client can offer Reopen rather than retrying", async () => {
    const { res } = await runUpdate({ startTime: "07:00" });
    if (!res.ok) expect(res.error.kind).toBe("conflict");
  });

  it("writes nothing", async () => {
    const { save } = await runUpdate({ endTime: "20:00" });
    expect(save).not.toHaveBeenCalled();
  });

  it("refuses even a harmless-looking note change", async () => {
    const { res, save } = await runUpdate({ note: "typo fix" });
    expect(res.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The overlap gate: an edit must not land a row on top of another one.
// ---------------------------------------------------------------------------

describe("UpdateTimeEntryUseCase — one person cannot be two places at once", () => {
  const OTHER_ID = asTimeEntryId("99999999-9999-9999-9999-999999999999");

  it("refuses a patch that lands on another row, naming the clash", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry()); // 08:00–10:00, ENTRY_ID
    repo.seed(makeEntry({ id: OTHER_ID, kind: "shop", startTime: "10:00", endTime: "22:00" }));
    const useCase = new UpdateTimeEntryUseCase(repo, new FixedClock(new Date("2026-07-07T12:00:00Z")));

    const result = await useCase.exec({ entryId: ENTRY_ID, startTime: "10:30", endTime: "11:00" }, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Overlaps Shop 10:00–22:00");
    expect(repo.saveCalls).toHaveLength(0);
  });

  it("lets a row move within its own old window — it never clashes with itself", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry()); // 08:00–10:00
    const useCase = new UpdateTimeEntryUseCase(repo, new FixedClock(new Date("2026-07-07T12:00:00Z")));

    const result = await useCase.exec({ entryId: ENTRY_ID, startTime: "08:30" }, ORG);

    expect(result.ok).toBe(true);
    expect(repo.saveCalls).toHaveLength(1);
  });

  it("checks the day the row is MOVING TO, not the day it came from", async () => {
    const repo = new FakeTimeEntryRepository();
    repo.seed(makeEntry()); // 2026-07-07 08:00–10:00
    repo.seed(makeEntry({ id: OTHER_ID, workDate: "2026-07-08", kind: "travel", startTime: "09:00", endTime: "17:00" }));
    const useCase = new UpdateTimeEntryUseCase(repo, new FixedClock(new Date("2026-07-07T12:00:00Z")));

    const result = await useCase.exec({ entryId: ENTRY_ID, workDate: "2026-07-08" }, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("Overlaps Travel 09:00–17:00");
  });
});
