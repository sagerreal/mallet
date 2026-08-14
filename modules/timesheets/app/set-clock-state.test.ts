/**
 * Unit tests for SetClockStateUseCase — the bridge between the pure tap planner and the timesheet.
 *
 * The subject here is what a tap WRITES: which row is closed, which is opened, which is thrown
 * away, and on what local day each of them lands. The transition matrix itself is proven in
 * domain/clock.test.ts and the zone arithmetic in domain/wall-clock.test.ts; these tests exist to
 * catch the wiring between them — the conversion from instants to (work_date, HH:MM), the order of
 * the writes, and the refusals that must leave the timesheet untouched.
 */

import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asUserId,
  asJobId,
  asTimeEntryId,
  FixedClock,
  type UserId,
  type JobId,
  type TimeEntryId,
  type CursorPage,
  type Paginated,
  type Result,
  type AppError,
} from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { TimeEntry, type TimeEntryKind } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import type { ClockTap } from "../domain/clock";
import {
  SetClockStateUseCase,
  type SetClockStateCommand,
  type SetClockStateResult,
} from "./set-clock-state";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LA = "America/Los_Angeles";
const SYDNEY = "Australia/Sydney";

const ORG = "22222222-2222-2222-2222-222222222222";
const TECH = asUserId("33333333-3333-3333-3333-333333333333");
const JOB_A = asJobId("44444444-4444-4444-4444-444444444444");
const JOB_B = asJobId("55555555-5555-5555-5555-555555555555");
const OPEN_ID = "11111111-1111-1111-1111-111111111111";

// One fixed morning. NOW is server time; taps are placed relative to it so the temporal bounds are
// exercised by real distances rather than magic literals.
// 2026-07-24 10:00 PDT — July, so Los Angeles is UTC-7.
const NOW = new Date("2026-07-24T17:00:00.000Z");
const LOCAL_DATE = "2026-07-24";
const LOCAL_NOW_HHMM = "10:00";

// The segment the morning punch opened: 07:42 PDT the same local day.
const OPENED_AT = new Date("2026-07-24T14:42:00.000Z");
const OPENED_HHMM = "07:42";

const MINUTE_MS = 60_000;

const minutes = (n: number): number => n * MINUTE_MS;
const after = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

interface RunningFixture {
  /** Override when a test seeds TWO running rows — one per lane — so their ids differ. */
  readonly id?: string;
  readonly kind: TimeEntryKind;
  readonly jobId?: JobId | null;
  readonly workDate?: string;
  readonly startTime?: string;
  readonly createdAt?: Date;
}

/** A running (un-ended) entry as the database would hand it back. */
const running = (fixture: RunningFixture): TimeEntry => {
  const created = fixture.createdAt ?? OPENED_AT;
  const result = TimeEntry.create({
    id: asTimeEntryId(fixture.id ?? OPEN_ID),
    orgId: asOrgId(ORG),
    techUserId: TECH,
    jobId: fixture.jobId ?? null,
    workDate: fixture.workDate ?? LOCAL_DATE,
    kind: fixture.kind,
    startTime: fixture.startTime ?? OPENED_HHMM,
    endTime: null,
    minutes: null,
    note: "",
    src: "clock",
    status: "draft",
    running: true,
    approvedAt: null,
    editedByUserId: null,
    createdAt: created,
    updatedAt: created,
  });
  if (!result.ok) throw new Error(`test setup: ${result.error.message}`);
  return result.value;
};

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

class SequentialIds implements IdGenerator {
  private n = 0;
  newId(): string {
    this.n += 1;
    return `new-entry-${this.n}`;
  }
}

type CreateInput = Parameters<TimeEntryRepository["create"]>[0];

class FakeTimeEntryRepository implements TimeEntryRepository {
  private rows = new Map<string, { entry: TimeEntry; deleted: boolean }>();
  /** Every write, in order — the close-before-open rule is an ordering claim, so it is recorded. */
  readonly ops: string[] = [];
  readonly created: TimeEntry[] = [];
  /** Kinds of every row this fake was asked to finish — the costing lane's closes included. */
  closedKinds(): string[] {
    return [...this.rows.values()]
      .filter((r) => !r.deleted && !r.entry.props.running)
      .map((r) => r.entry.props.kind);
  }
  readonly saved: TimeEntry[] = [];
  readonly removed: string[] = [];
  readonly findOpenCalls: UserId[] = [];

  seed(entry: TimeEntry): void {
    this.rows = new Map(this.rows).set(entry.props.id, { entry, deleted: false });
  }

  get writeCount(): number {
    return this.created.length + this.saved.length + this.removed.length;
  }

  /** The running row in one LANE — the shift (what pays) or the job overlay (costing). */
  private openRow(techUserId: string, lane: "shift" | "job" = "shift"): TimeEntry | null {
    for (const row of this.rows.values()) {
      const p = row.entry.props;
      if (row.deleted || !p.running || p.techUserId !== techUserId) continue;
      if ((lane === "job") === (p.kind === "job")) return row.entry;
    }
    return null;
  }

  async findOpenForTech(techUserId: UserId): Promise<TimeEntry | null> {
    this.findOpenCalls.push(techUserId);
    return this.openRow(techUserId, "shift");
  }

  /** The costing lane — a job row runs beside the shift, never instead of it. */
  async findOpenJobForTech(techUserId: UserId): Promise<TimeEntry | null> {
    return this.openRow(techUserId, "job");
  }

  async create(input: CreateInput): Promise<TimeEntry> {
    // Mirrors migration 0158: one running row per technician PER LANE. Two shift segments still
    // double-count and are still impossible; a job row running beside the shift is the point.
    // Without this an ordering bug (open before close) would pass every test in this file.
    const lane = input.kind === "job" ? "job" : "shift";
    if (input.running && this.openRow(input.techUserId, lane) !== null) {
      throw new Error(`fake repository: a technician cannot have two running ${lane} entries`);
    }
    const result = TimeEntry.create({
      id: asTimeEntryId(input.id),
      orgId: asOrgId(input.orgId),
      techUserId: asUserId(input.techUserId),
      jobId: input.jobId === null ? null : asJobId(input.jobId),
      workDate: input.workDate,
      kind: input.kind as TimeEntryKind,
      startTime: input.startTime,
      endTime: input.endTime,
      minutes: null,
      note: input.note,
      src: input.src as "manual" | "clock" | "timer",
      status: input.status as "draft" | "approved",
      running: input.running,
      approvedAt: null,
    editedByUserId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (!result.ok) throw new Error(`fake repository rejected an insert: ${result.error.message}`);
    this.rows = new Map(this.rows).set(input.id, { entry: result.value, deleted: false });
    this.ops.push(input.running ? "create:running" : "create:finished");
    this.created.push(result.value);
    return result.value;
  }

  async save(entry: TimeEntry): Promise<void> {
    this.rows = new Map(this.rows).set(entry.props.id, { entry, deleted: false });
    this.ops.push("save");
    this.saved.push(entry);
  }

  async remove(id: TimeEntryId): Promise<number> {
    const row = this.rows.get(id);
    if (!row || row.deleted) return 0;
    this.rows = new Map(this.rows).set(id, { entry: row.entry, deleted: true });
    this.ops.push("remove");
    this.removed.push(id);
    return 1;
  }

  async findById(id: TimeEntryId): Promise<TimeEntry | null> {
    const row = this.rows.get(id);
    return row && !row.deleted ? row.entry : null;
  }

  // Not exercised by the clock — it never lists, and approval is a different use-case.
  async count(): Promise<number> {
    return 0;
  }

  async list(_filter: unknown, _page: CursorPage): Promise<Paginated<TimeEntry>> {
    return { items: [], nextCursor: null };
  }
  async unfinishedDates(): Promise<string[]> {
    return [];
  }
  async approveWeek(): Promise<number> {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface RunOptions {
  /** Rows to seed besides `open` — e.g. a job row running in the costing lane. */
  readonly extraRows?: readonly TimeEntry[];
  readonly open?: TimeEntry;
  readonly timeZone?: string;
  readonly now?: Date;
}

interface RunOutcome {
  readonly result: Result<SetClockStateResult, AppError>;
  readonly repo: FakeTimeEntryRepository;
}

const tapWith = async (
  cmd: { tap: ClockTap; jobId?: JobId | null; at?: Date },
  options: RunOptions = {},
): Promise<RunOutcome> => {
  const now = options.now ?? NOW;
  const repo = new FakeTimeEntryRepository();
  if (options.open) repo.seed(options.open);
  // Rows in the OTHER lane — a job running beside the shift. Seeded separately because the two
  // lanes are found by two different reads since migration 0158.
  for (const row of options.extraRows ?? []) repo.seed(row);
  const useCase = new SetClockStateUseCase(
    repo,
    new FixedClock(now),
    new SequentialIds(),
    options.timeZone ?? LA,
  );
  const command: SetClockStateCommand = {
    techUserId: TECH,
    tap: cmd.tap,
    jobId: cmd.jobId ?? null,
    at: cmd.at ?? now,
  };
  return { result: await useCase.exec(command, ORG), repo };
};

const succeeded = (outcome: RunOutcome): SetClockStateResult => {
  if (!outcome.result.ok) {
    throw new Error(`expected a successful tap, got: ${outcome.result.error.message}`);
  }
  return outcome.result.value;
};

const refusal = (outcome: RunOutcome): AppError => {
  if (outcome.result.ok) throw new Error("expected the tap to be refused");
  return outcome.result.error;
};

// ---------------------------------------------------------------------------
// From an idle clock — nothing running
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — from an idle clock", () => {
  it("Start day opens one running shop entry and closes nothing", async () => {
    const outcome = await tapWith({ tap: "start_day" });

    const result = succeeded(outcome);
    expect(result.opened?.props.kind).toBe("shop");
    expect(result.opened?.props.running).toBe(true);
    expect(result.opened?.props.endTime).toBeNull();
    expect(result.opened?.props.workDate).toBe(LOCAL_DATE);
    expect(result.opened?.props.startTime).toBe(LOCAL_NOW_HHMM);
    expect(result.closed).toEqual([]);
    expect(outcome.repo.writeCount).toBe(1);
  });

  it("On my way with no day open starts the SHIFT — the morning punch nobody made", async () => {
    // The job itself opens in the costing lane beside it; `opened` is the row that PAYS.
    const outcome = await tapWith({ tap: "enroute", jobId: JOB_A });

    const result = succeeded(outcome);
    expect(result.opened?.props.kind).toBe("shop");
    expect(result.closed).toEqual([]);
  });

  it("Arrived with no day open starts the shift too", async () => {
    const outcome = await tapWith({ tap: "arrived", jobId: JOB_A });

    const result = succeeded(outcome);
    expect(result.opened?.props.kind).toBe("shop");
  });

  it("Break with no day open opens the break rather than doing nothing", async () => {
    const outcome = await tapWith({ tap: "break" });

    expect(succeeded(outcome).opened?.props.kind).toBe("break");
  });

  it("Done with nothing running writes nothing and is still a success", async () => {
    const outcome = await tapWith({ tap: "done", jobId: JOB_A });

    const result = succeeded(outcome);
    expect(result.noop).toBe(true);
    expect(result.opened).toBeNull();
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("End break with nothing running writes nothing", async () => {
    const outcome = await tapWith({ tap: "end_break" });

    expect(succeeded(outcome).noop).toBe(true);
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("End day with nothing running writes nothing", async () => {
    const outcome = await tapWith({ tap: "end_day" });

    expect(succeeded(outcome).noop).toBe(true);
    expect(outcome.repo.writeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// From shop time
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — from shop time", () => {
  const shop = () => running({ kind: "shop" });

  it("On my way LEAVES the shift running — the job opens beside it", async () => {
    // The whole change: the man is on the clock AND on a job. One fact about one hour, so the
    // shift is not closed and re-opened around it.
    const outcome = await tapWith({ tap: "enroute", jobId: JOB_A }, { open: shop() });

    const result = succeeded(outcome);
    expect(result.closed).toEqual([]);
    expect(result.noop).toBe(true);
    // The job row landed in the costing lane, which `opened` does not report.
    expect(outcome.repo.created.some((c) => c.props.kind === "job" && c.props.jobId === JOB_A)).toBe(true);
  });

  it("Arrived leaves the shift running too", async () => {
    const outcome = await tapWith({ tap: "arrived", jobId: JOB_A }, { open: shop() });

    const result = succeeded(outcome);
    expect(result.closed).toEqual([]);
    expect(outcome.repo.created.some((c) => c.props.kind === "job")).toBe(true);
  });

  it("Break closes the shop segment and opens the break", async () => {
    const outcome = await tapWith({ tap: "break" }, { open: shop() });

    const result = succeeded(outcome);
    expect(result.closed).toHaveLength(1);
    expect(result.opened?.props.kind).toBe("break");
  });

  it("End day closes the segment and leaves nothing running", async () => {
    const outcome = await tapWith({ tap: "end_day" }, { open: shop() });

    const result = succeeded(outcome);
    expect(result.opened).toBeNull();
    expect(result.closed[0]?.props.endTime).toBe(LOCAL_NOW_HHMM);
    expect(result.closed[0]?.props.running).toBe(false);
    expect(outcome.repo.created).toEqual([]);
  });

  it("a second Start day writes nothing — the clock is already where the tap wants it", async () => {
    const outcome = await tapWith({ tap: "start_day" }, { open: shop() });

    expect(succeeded(outcome).noop).toBe(true);
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("a no-op leaves the running entry exactly as it was", async () => {
    const open = shop();
    const outcome = await tapWith({ tap: "start_day" }, { open });

    expect(succeeded(outcome).noop).toBe(true);
    await expect(outcome.repo.findOpenForTech(TECH)).resolves.toBe(open);
  });
});

// ---------------------------------------------------------------------------
// From travel and job time
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — from a legacy travel row", () => {
  // Nothing writes `travel` any more (On my way starts job time), but days worked before that
  // change still hold these rows and the clock has to close them correctly.
  const travel = () => running({ kind: "travel", jobId: JOB_A });

  it("Arrived closes a legacy travel row and opens job time on the same job", async () => {
    const outcome = await tapWith({ tap: "arrived", jobId: JOB_A }, { open: travel() });

    const result = succeeded(outcome);
    expect(result.closed[0]?.props.kind).toBe("travel");
    expect(result.closed[0]?.props.endTime).toBe(LOCAL_NOW_HHMM);
    // The shift resumes as REGULAR; the job opens in the costing lane beside it.
    expect(result.opened?.props.kind).toBe("shop");
    expect(outcome.repo.created.some((c) => c.props.kind === "job" && c.props.jobId === JOB_A)).toBe(true);
  });

  it("Done closes a legacy travel row and resumes unassigned regular time", async () => {
    const outcome = await tapWith({ tap: "done" }, { open: travel() });

    const result = succeeded(outcome);
    expect(result.closed[0]?.props.kind).toBe("travel");
    expect(result.opened?.props.kind).toBe("shop");
    expect(result.opened?.props.jobId).toBeNull();
  });

  it("Start day mid-travel writes nothing, so the job keeps its travel time", async () => {
    const outcome = await tapWith({ tap: "start_day" }, { open: travel() });

    expect(succeeded(outcome).noop).toBe(true);
    expect(outcome.repo.writeCount).toBe(0);
  });
});

/**
 * The COSTING lane — a job row running beside the shift, not instead of a slice of it.
 *
 * `open` in these fixtures is the SHIFT (regular time), because that is what runs all day. The job
 * row is found through findOpenJobForTech and never appears in `opened`, which reports the row that
 * pays.
 */
describe("SetClockStateUseCase — the job running beside the shift", () => {
  const onShift = () => running({ kind: "shop" });
  /** A job row already running in the costing lane, alongside the shift. */
  const alsoOnJob = (jobId: JobId) =>
    running({ kind: "job", jobId, id: "cccccccc-cccc-cccc-cccc-cccccccccccc" });

  it("Done closes the job and LEAVES the shift running — he is still on the clock", async () => {
    const outcome = await tapWith({ tap: "done" }, { open: onShift(), extraRows: [alsoOnJob(JOB_A)] });

    const result = succeeded(outcome);
    // The shift is untouched; only the job row ended.
    expect(result.closed.some((c) => c.props.kind === "shop")).toBe(false);
    expect(outcome.repo.closedKinds()).toContain("job");
  });

  it("On my way to the NEXT job closes the first and opens the second", async () => {
    const outcome = await tapWith({ tap: "enroute", jobId: JOB_B }, { open: onShift(), extraRows: [alsoOnJob(JOB_A)] });

    succeeded(outcome);
    expect(outcome.repo.created.some((c) => c.props.kind === "job" && c.props.jobId === JOB_B)).toBe(true);
  });

  it("Break closes the job — a man on his lunch is not on the job", async () => {
    // Leaving it open would charge the customer for his sandwich.
    const outcome = await tapWith({ tap: "break" }, { open: onShift(), extraRows: [alsoOnJob(JOB_A)] });

    const result = succeeded(outcome);
    expect(result.opened?.props.kind).toBe("break");
    expect(outcome.repo.closedKinds()).toContain("job");
  });

  it("End day closes the job as well as the shift", async () => {
    const outcome = await tapWith({ tap: "end_day" }, { open: onShift(), extraRows: [alsoOnJob(JOB_A)] });

    const result = succeeded(outcome);
    expect(result.opened).toBeNull();
    expect(outcome.repo.closedKinds()).toContain("job");
  });

  it("tapping Arrived on the SAME job again changes nothing", async () => {
    // Closing to reopen would split one stretch of work into two rows that each look like a visit.
    const outcome = await tapWith({ tap: "arrived", jobId: JOB_A }, { open: onShift(), extraRows: [alsoOnJob(JOB_A)] });

    succeeded(outcome);
    expect(outcome.repo.created.filter((c) => c.props.kind === "job")).toHaveLength(0);
  });
});

describe("SetClockStateUseCase — from a break", () => {
  const onBreak = () => running({ kind: "break" });

  it("End break closes the break and resumes shop time", async () => {
    const outcome = await tapWith({ tap: "end_break" }, { open: onBreak() });

    const result = succeeded(outcome);
    expect(result.closed[0]?.props.kind).toBe("break");
    expect(result.closed[0]?.props.endTime).toBe(LOCAL_NOW_HHMM);
    expect(result.opened?.props.kind).toBe("shop");
  });

  it("Arrived ends the break and puts him back on the clock, on that job", async () => {
    const outcome = await tapWith({ tap: "arrived", jobId: JOB_A }, { open: onBreak() });

    const result = succeeded(outcome);
    expect(result.closed[0]?.props.kind).toBe("break");
    // The SHIFT resumes; the job lands beside it, which `opened` does not report.
    expect(result.opened?.props.kind).toBe("shop");
    expect(outcome.repo.created.some((c) => c.props.kind === "job")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The zero-length collapse — the six-Dones-at-6pm case
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — a segment shorter than a minute", () => {
  // Opened in the same minute the next tap lands in: nothing happened in between. A SHIFT row —
  // the collapse is about the segment that pays; the costing lane is found separately.
  const justOpened = () =>
    running({ kind: "shop", startTime: LOCAL_NOW_HHMM, createdAt: NOW });

  it("soft-deletes the segment instead of recording a zero-length row", async () => {
    // Break, not Done: Done ends the JOB now and leaves the shift alone, so it cannot collapse a
    // shift segment. Break is a tap that genuinely changes the shift.
    const outcome = await tapWith({ tap: "break", at: after(NOW, 20_000) }, { open: justOpened() });

    const result = succeeded(outcome);
    expect(outcome.repo.removed).toEqual([OPEN_ID]);
    expect(outcome.repo.saved).toEqual([]);
    expect(result.closed).toEqual([]);
  });

  it("reports the discarded entry so the caller can drop the row it was showing", async () => {
    const outcome = await tapWith({ tap: "break", at: after(NOW, 20_000) }, { open: justOpened() });

    expect(succeeded(outcome).discardedEntryId).toBe(OPEN_ID);
  });

  it("still opens the next segment, so the technician stays on the clock", async () => {
    const outcome = await tapWith({ tap: "break", at: after(NOW, 20_000) }, { open: justOpened() });

    const result = succeeded(outcome);
    expect(result.opened?.props.kind).toBe("break");
    expect(result.opened?.props.running).toBe(true);
  });

  it("End day in the same minute discards the segment and leaves nothing running", async () => {
    const outcome = await tapWith(
      { tap: "end_day", at: after(NOW, 20_000) },
      { open: justOpened() },
    );

    const result = succeeded(outcome);
    expect(outcome.repo.removed).toEqual([OPEN_ID]);
    expect(result.opened).toBeNull();
    expect(outcome.repo.created).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Crossing local midnight — the 10:40pm emergency call
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — a segment that runs past local midnight", () => {
  // 22:40 PDT on the 23rd → 05:40 UTC on the 24th.
  const LATE_JOB_START = new Date("2026-07-24T05:40:00.000Z");
  // 00:20 PDT on the 24th → 07:20 UTC.
  const FINISHED_AT = new Date("2026-07-24T07:20:00.000Z");

  const overnight = () =>
    running({
      kind: "shop",
      workDate: "2026-07-23",
      startTime: "22:40",
      createdAt: LATE_JOB_START,
    });

  const tapDone = () =>
    tapWith(
      { tap: "end_day", at: FINISHED_AT }, { open: overnight(), now: FINISHED_AT });

  it("ends the first day at 23:59 rather than writing an impossible row", async () => {
    const result = succeeded(await tapDone());

    expect(result.closed[0]?.props.workDate).toBe("2026-07-23");
    expect(result.closed[0]?.props.startTime).toBe("22:40");
    expect(result.closed[0]?.props.endTime).toBe("23:59");
    expect(result.closed[0]?.props.running).toBe(false);
  });

  it("writes the remainder as a finished row on the next local day", async () => {
    const result = succeeded(await tapDone());

    expect(result.closed).toHaveLength(2);
    expect(result.closed[1]?.props.workDate).toBe("2026-07-24");
    expect(result.closed[1]?.props.startTime).toBe("00:00");
    expect(result.closed[1]?.props.endTime).toBe("00:20");
    expect(result.closed[1]?.props.running).toBe(false);
  });

  it("dates the remainder to the new local day", async () => {
    const result = succeeded(await tapDone());

    expect(result.closed[1]?.props.workDate).toBe("2026-07-24");
    expect(result.closed[1]?.props.startTime).toBe("00:00");
  });

  it("leaves nothing running — End day ends the day", async () => {
    expect(succeeded(await tapDone()).opened).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The shop's timezone decides the work day
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — the shop's timezone decides the work day", () => {
  // 21:30 PDT on the 24th, which is already 04:30 UTC on the 25th.
  const EVENING = new Date("2026-07-25T04:30:00.000Z");

  it("files an evening tap on the local work day, not the UTC one", async () => {
    const outcome = await tapWith({ tap: "start_day", at: EVENING }, { now: EVENING });

    const result = succeeded(outcome);
    expect(result.opened?.props.workDate).toBe("2026-07-24");
    expect(result.opened?.props.startTime).toBe("21:30");
  });

  it("files the same instant on its own local day for a shop in Sydney", async () => {
    const outcome = await tapWith(
      { tap: "start_day", at: EVENING },
      { now: EVENING, timeZone: SYDNEY },
    );

    const result = succeeded(outcome);
    expect(result.opened?.props.workDate).toBe("2026-07-25");
    expect(result.opened?.props.startTime).toBe("14:30");
  });

  it("refuses an unknown timezone instead of guessing a day, and writes nothing", async () => {
    const outcome = await tapWith({ tap: "start_day" }, { timeZone: "Mars/Olympus_Mons" });

    expect(refusal(outcome).kind).toBe("validation");
    expect(outcome.repo.writeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Refusals — a rejected tap must leave the timesheet exactly as it found it
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — a refused tap writes nothing", () => {
  it("refuses On my way with no job, because the travel could not be costed", async () => {
    const outcome = await tapWith({ tap: "enroute", jobId: null }, { open: running({ kind: "shop" }) });

    const error = refusal(outcome);
    expect(error.kind).toBe("validation");
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("refuses a device timestamp far in the future", async () => {
    const outcome = await tapWith(
      { tap: "start_day", at: after(NOW, minutes(6)) },
      { open: undefined },
    );

    expect(refusal(outcome).kind).toBe("validation");
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("refuses a tap timestamped before the running segment started", async () => {
    const outcome = await tapWith(
      { tap: "end_day", at: after(OPENED_AT, -minutes(2)) },
      { open: running({ kind: "shop" }) },
    );

    expect(refusal(outcome).kind).toBe("validation");
    expect(outcome.repo.writeCount).toBe(0);
  });

  it("refuses to close a running entry whose recorded date disagrees with when it started", async () => {
    // A hand-typed running row dated four days before it was opened: the split and the row would be
    // describing different segments, and writing an end time across that gap invents hours.
    const outcome = await tapWith(
      { tap: "end_day" },
      { open: running({ kind: "shop", workDate: "2026-07-20" }) },
    );

    const error = refusal(outcome);
    expect(error.kind).toBe("validation");
    expect(error.message).toContain("2026-07-20");
    expect(outcome.repo.writeCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// How the rows are written
// ---------------------------------------------------------------------------

describe("SetClockStateUseCase — how the rows reach the timesheet", () => {
  it("stops the running entry BEFORE starting the next one, so two SHIFTS never run at once", async () => {
    // Break, not Arrived: Arrived leaves the shift alone now and only adds a costing row, so it no
    // longer exercises the close-then-open ordering this test exists for.
    const outcome = await tapWith({ tap: "break" }, { open: running({ kind: "shop" }) });

    succeeded(outcome);
    expect(outcome.repo.ops).toEqual(["save", "create:running"]);
  });

  it("discards the collapsed segment BEFORE starting the next one", async () => {
    const outcome = await tapWith(
      { tap: "break", at: after(NOW, 20_000) },
      { open: running({ kind: "shop", startTime: LOCAL_NOW_HHMM, createdAt: NOW }) },
    );

    succeeded(outcome);
    expect(outcome.repo.ops).toEqual(["remove", "create:running"]);
  });

  it("writes the midnight rows in day order, finished ones before the new running one", async () => {
    const finishedAt = new Date("2026-07-24T07:20:00.000Z");
    const outcome = await tapWith(
      { tap: "break", at: finishedAt },
      {
        now: finishedAt,
        open: running({
          kind: "shop",
          workDate: "2026-07-23",
          startTime: "22:40",
          createdAt: new Date("2026-07-24T05:40:00.000Z"),
        }),
      },
    );

    succeeded(outcome);
    expect(outcome.repo.ops).toEqual(["save", "create:finished", "create:running"]);
  });

  it("marks its rows as clock-written and never as approved", async () => {
    const outcome = await tapWith({ tap: "start_day" });

    const opened = succeeded(outcome).opened;
    expect(opened?.props.src).toBe("clock");
    expect(opened?.props.status).toBe("draft");
    expect(opened?.props.note).toBe("");
  });

  it("stamps the row with the org the caller supplied, never one from the command", async () => {
    const outcome = await tapWith({ tap: "start_day" });

    expect(succeeded(outcome).opened?.props.orgId).toBe(ORG);
  });

  it("reads the open entry for the tapping technician only", async () => {
    const outcome = await tapWith({ tap: "start_day" });

    expect(outcome.repo.findOpenCalls).toEqual([TECH]);
  });
});

// Two reviewers independently found this, and it is the worst class of bug this feature can have.
//
// A forgotten End day used to be closed at the tap instant, and splitAtMidnight then materialised a
// FULL 00:00->23:59 paid row for every intervening local day. A Monday-evening segment closed by
// Tuesday morning's first tap billed ~14.5 hours nobody worked — as finished draft rows that passed
// the unfinished-week guard and would have reached payroll unchallenged.
//
// The bound applies ONLY to a stale segment. Crossing midnight is not itself suspicious: the
// 22:40->00:20 emergency call is the highest-margin job in the beachhead and must still split
// cleanly. Both halves are pinned here so neither can regress into the other.
describe("a forgotten End day cannot bill hours nobody worked", () => {
  // Started 07:42 local Friday; the next tap comes the following morning.
  const nextMorning = new Date("2026-07-25T14:15:00.000Z"); // 07:15 local Saturday

  const staleOutcome = () =>
    tapWith({ tap: "end_day", at: nextMorning }, { open: running({ kind: "shop" }), now: nextMorning });

  it("writes ONE row, never a row per intervening day", async () => {
    const result = succeeded(await staleOutcome());
    expect(result.closed).toHaveLength(1);
  });

  it("keeps that row on the day the segment actually started", async () => {
    const result = succeeded(await staleOutcome());
    expect(result.closed[0]?.props.workDate).toBe(LOCAL_DATE);
  });

  it("caps the hours at one plausible stretch instead of billing overnight", async () => {
    const result = succeeded(await staleOutcome());
    const hours = result.closed[0]?.hours() ?? 0;
    // 07:42 + 12h = 19:42 local, which is earlier than that day's 23:59, so the cap is the stretch.
    expect(hours).toBeCloseTo(12, 2);
    // The unbounded bug produced 23.5h across two rows; anything near that is the regression.
    expect(hours).toBeLessThan(13);
  });

  it("flags the row as an estimate, so a human is asked rather than told", async () => {
    const result = succeeded(await staleOutcome());
    expect(result.boundedClose).toBe(true);
  });

  it("does not flag an ordinary close", async () => {
    const result = succeeded(
      await tapWith({ tap: "end_day" }, { open: running({ kind: "shop" }) }),
    );
    expect(result.boundedClose).toBe(false);
  });
});

describe("the after-midnight emergency call survives the bound", () => {
  // 22:40 local Friday -> 00:20 local Saturday: ~100 minutes, the shop's best-paid work.
  const startedAt = new Date("2026-07-25T05:40:00.000Z"); // 22:40 local Fri
  const endedAt = new Date("2026-07-25T07:20:00.000Z"); // 00:20 local Sat

  const outcome = () =>
    tapWith(
      { tap: "end_day", at: endedAt },
      {
        open: running({ kind: "shop", workDate: "2026-07-24", startTime: "22:40", createdAt: startedAt }),
        now: endedAt,
      },
    );

  it("still splits into two rows across the midnight boundary", async () => {
    const result = succeeded(await outcome());
    expect(result.closed).toHaveLength(2);
  });

  it("is NOT treated as a stale segment", async () => {
    const result = succeeded(await outcome());
    expect(result.boundedClose).toBe(false);
  });

  it("dates the after-midnight half to the new day", async () => {
    const result = succeeded(await outcome());
    expect(result.closed[1]?.props.workDate).toBe("2026-07-25");
  });
});
