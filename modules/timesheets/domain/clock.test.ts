import { describe, it, expect } from "vitest";
import {
  planTap,
  MAX_OPEN_SEGMENT_MS,
  MAX_FUTURE_SKEW_MS,
  MAX_BACKDATE_MS,
  MAX_BACKWARDS_SKEW_MS,
  type ClockPlan,
  type ClockState,
  type ClockTap,
  type OpenEntry,
  type TapInput,
  jobTargetFor,
  CLOSE_JOB,
} from "./clock";

const JOB_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// One fixed day. NOW is server time; taps are placed relative to it, so the temporal bounds are
// exercised by real distances rather than by magic literals.
const NOW = new Date("2026-07-24T17:00:00.000Z");
const mins = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type PlanResult = ReturnType<typeof planTap>;

const openEntry = (
  kind: ClockState,
  jobId: string | null,
  startedAt: Date = at(-hours(1)),
): OpenEntry => ({ id: "entry-open", kind, jobId, startedAt });

const tap = (over: Partial<TapInput> & { tap: ClockTap }): PlanResult =>
  planTap({ open: null, at: NOW, jobId: null, now: NOW, ...over });

const planOf = (res: PlanResult): ClockPlan => {
  if (!res.ok) throw new Error(`expected a plan, got: ${res.error.message}`);
  return res.value;
};

// ---------------------------------------------------------------------------
// The transition matrix — the contract, stated once and proven exhaustive.
// ---------------------------------------------------------------------------

const ALL_TAPS: readonly ClockTap[] = [
  "start_day",
  "enroute",
  "arrived",
  "done",
  "break",
  "end_break",
  "end_day",
];

/** The five clock states a tap can arrive into; `idle` means nothing is running. */
const ALL_STATES = ["idle", "shop", "travel", "job", "break"] as const;
type MatrixState = (typeof ALL_STATES)[number];

interface Row {
  readonly state: MatrixState;
  readonly tap: ClockTap;
  readonly closes: boolean;
  readonly opens: { kind: ClockState; jobId: string | null } | null;
  readonly noop: boolean;
}

const row = (
  state: MatrixState,
  tapName: ClockTap,
  closes: boolean,
  opens: Row["opens"],
  noop = false,
): Row => ({ state, tap: tapName, closes, opens, noop });

const SHOP = { kind: "shop" as const, jobId: null };
const TRAVEL_A = { kind: "travel" as const, jobId: JOB_A };
const JOB_ON_A = { kind: "job" as const, jobId: JOB_A };
const ON_BREAK = { kind: "break" as const, jobId: null };
const NO = null;

// Read this as the product spec. Every cell is a decision someone can argue with.
const MATRIX: readonly Row[] = [
  // Idle: only taps that MEAN "I am starting something" may open. Exit taps are no-ops, so a
  // stray Done after the day ended can never put the technician back on the clock.
  row("idle", "start_day", false, SHOP),
  // On my way / Arrived open the SHIFT from idle (the morning punch costs no extra tap). The job
  // itself goes to the costing lane — jobTargetFor — and runs beside this row, not instead of it.
  row("idle", "enroute", false, SHOP),
  row("idle", "arrived", false, SHOP),
  row("idle", "done", false, NO, true),
  row("idle", "break", false, ON_BREAK),
  row("idle", "end_break", false, NO, true),
  row("idle", "end_day", false, NO, true),

  // Shift running. A job tap leaves it exactly where it is — that is the whole change.
  row("shop", "start_day", false, NO, true), // already there
  row("shop", "enroute", false, NO, true),
  row("shop", "arrived", false, NO, true),
  row("shop", "done", false, NO, true), // the job closes in the costing lane; the shift carries on
  row("shop", "break", true, ON_BREAK),
  row("shop", "end_break", false, NO, true), // not on a break
  row("shop", "end_day", true, NO),

  // A legacy travel or job row in the SHIFT lane — days worked before this change still hold them,
  // and the clock has to resolve them back onto regular time.
  row("travel", "start_day", false, NO, true),
  row("travel", "enroute", true, SHOP),
  row("travel", "arrived", true, SHOP),
  row("travel", "done", true, SHOP),
  row("travel", "break", true, ON_BREAK),
  row("travel", "end_break", false, NO, true),
  row("travel", "end_day", true, NO),

  row("job", "start_day", false, NO, true),
  row("job", "enroute", true, SHOP),
  row("job", "arrived", true, SHOP),
  row("job", "done", true, SHOP),
  row("job", "break", true, ON_BREAK),
  row("job", "end_break", false, NO, true),
  row("job", "end_day", true, NO),

  // Break running.
  row("break", "start_day", false, NO, true), // use End break
  row("break", "enroute", true, SHOP),
  row("break", "arrived", true, SHOP),
  row("break", "done", true, SHOP),
  row("break", "break", false, NO, true), // already on a break
  row("break", "end_break", true, SHOP),
  row("break", "end_day", true, NO),
];

const openFor = (state: MatrixState): OpenEntry | null => {
  switch (state) {
    case "idle":
      return null;
    case "shop":
      return openEntry("shop", null);
    case "travel":
      return openEntry("travel", JOB_A);
    case "job":
      return openEntry("job", JOB_A);
    case "break":
      return openEntry("break", null);
  }
};

// `enroute`/`arrived` must carry a job; the others must not.
const jobArgFor = (tapName: ClockTap): string | null =>
  tapName === "enroute" || tapName === "arrived" ? JOB_A : null;

const runRow = (r: Row): PlanResult =>
  planTap({ tap: r.tap, open: openFor(r.state), at: NOW, jobId: jobArgFor(r.tap), now: NOW });

describe("the transition matrix is exhaustive", () => {
  // Counting rows is NOT proof: a duplicated row plus a dropped pair still totals 35, and the
  // dropped behaviour then ships unproven. Assert the SET of (state, tap) pairs instead.
  it("covers every (state, tap) pair exactly once", () => {
    const keys = MATRIX.map((r) => `${r.state}|${r.tap}`);
    const expected = ALL_STATES.flatMap((s) => ALL_TAPS.map((t) => `${s}|${t}`));

    expect(new Set(keys).size).toBe(keys.length); // no duplicates
    expect([...keys].sort()).toEqual([...expected].sort()); // no gaps, no strays
  });
});

describe.each(MATRIX)("$state + $tap", (r) => {
  it(
    r.noop ? "writes nothing" : r.closes ? "closes the running entry" : "opens without closing",
    () => {
      const plan = planOf(runRow(r));
      expect(plan.noop).toBe(r.noop);
      expect(plan.close !== null).toBe(r.closes);
    },
  );

  it(r.opens ? `runs ${r.opens.kind} afterwards` : "runs nothing afterwards", () => {
    const plan = planOf(runRow(r));
    if (r.opens === null) {
      expect(plan.open).toBeNull();
    } else {
      expect(plan.open).toMatchObject(r.opens);
    }
  });
});

// What the old "totality" block should have been. `typeof r.ok === "boolean"` is true for every
// Result ever constructed, so a planTap that refused EVERY tap passed it — a mutation that would
// stop every technician in the field from clocking in at all.
describe("totality — real behaviour across the whole matrix", () => {
  it("succeeds for every (state, tap) pair, with the matrix outcome", () => {
    for (const r of MATRIX) {
      const res = runRow(r);
      expect(res.ok, `${r.state}|${r.tap} should be plannable`).toBe(true);
      if (!res.ok) continue;
      expect(res.value.noop, `${r.state}|${r.tap} noop`).toBe(r.noop);
      expect(res.value.close !== null, `${r.state}|${r.tap} closes`).toBe(r.closes);
    }
  });

  it("never throws, even for junk the type system says is impossible", () => {
    const junk: unknown[] = [
      { tap: "not_a_tap", open: null, at: NOW, jobId: null, now: NOW },
      // A Symbol throws on string interpolation, so the guard must not stringify what it rejects.
      { tap: Symbol("x"), open: null, at: NOW, jobId: null, now: NOW },
      { tap: "done", open: undefined, at: NOW, jobId: null, now: NOW },
      { tap: "done", open: null, at: new Date("nope"), jobId: null, now: NOW },
      { tap: "done", open: null, at: NOW, jobId: null, now: new Date("nope") },
      {
        tap: "done",
        open: { id: "x", kind: "job", jobId: JOB_A, startedAt: new Date("nope") },
        at: NOW,
        jobId: null,
        now: NOW,
      },
    ];
    for (const input of junk) {
      expect(() => planTap(input as TapInput)).not.toThrow();
      // `undefined` open is legal (it means idle), so only the genuinely invalid ones must fail.
      const res = planTap(input as TapInput);
      if ((input as TapInput).tap === "done" && (input as TapInput).open === undefined) continue;
      expect(res.ok).toBe(false);
    }
  });

  it("treats an undefined open entry as idle rather than dereferencing it", () => {
    // undefined is exactly what a repository lookup returns when it forgets `row ?? null`.
    const res = planTap({ tap: "start_day", open: undefined, at: NOW, jobId: null, now: NOW });
    expect(planOf(res).open).toMatchObject(SHOP);
  });
});

describe("a stray exit tap can never restart the clock", () => {
  it.each(["done", "end_break", "end_day"] as const)(
    "%s with nothing running writes nothing",
    (t) => {
      expect(planOf(tap({ tap: t }))).toMatchObject({ noop: true, close: null, open: null });
    },
  );

  it("a Done tapped after the day ended does not put the tech back on the clock", () => {
    const afterEndDay = planOf(tap({ tap: "end_day", open: openEntry("shop", null) }));
    expect(afterEndDay.open).toBeNull();

    const stray = planOf(tap({ tap: "done", open: null, at: at(mins(5)) }));
    expect(stray.open).toBeNull();
    expect(stray.noop).toBe(true);
  });
});

describe("a mis-tap never destroys attribution", () => {
  it.each(["travel", "job"] as const)("Start day while %s is running writes nothing", (state) => {
    expect(planOf(tap({ tap: "start_day", open: openFor(state) }))).toMatchObject({
      noop: true,
      close: null,
    });
  });

  it("Start day mid-job leaves the job segment open, so its costing survives", () => {
    const plan = planOf(tap({ tap: "start_day", open: openEntry("job", JOB_A) }));
    expect(plan.close).toBeNull();
    expect(plan.open).toBeNull();
  });

  it.each(["shop", "travel", "job"] as const)(
    "End break while %s is running writes nothing",
    (state) => {
      expect(planOf(tap({ tap: "end_break", open: openFor(state) }))).toMatchObject({
        noop: true,
        close: null,
      });
    },
  );
});

describe("a forgotten End day cannot absorb the weekend", () => {
  const staleShop = openEntry("shop", null, at(-MAX_OPEN_SEGMENT_MS - mins(1)));

  it("Start day re-anchors a stale segment instead of no-op'ing into it", () => {
    const plan = planOf(tap({ tap: "start_day", open: staleShop }));
    expect(plan.noop).toBe(false);
    expect(plan.close).toMatchObject({ id: staleShop.id });
    expect(plan.open).toMatchObject(SHOP);
  });

  it("the fresh segment starts at the tap, not at the stale segment's start", () => {
    expect(planOf(tap({ tap: "start_day", open: staleShop })).open?.startedAt).toEqual(NOW);
  });

  it("a segment inside the limit is still treated as the same one", () => {
    const fresh = openEntry("shop", null, at(-MAX_OPEN_SEGMENT_MS + mins(1)));
    expect(planOf(tap({ tap: "start_day", open: fresh })).noop).toBe(true);
  });
});

describe("the tap timestamp is bounded in both directions", () => {
  it("refuses a tap far in the future, which no later tap could close", () => {
    expect(tap({ tap: "start_day", at: at(MAX_FUTURE_SKEW_MS + mins(1)) }).ok).toBe(false);
  });

  it("allows ordinary forward device skew", () => {
    expect(tap({ tap: "start_day", at: at(MAX_FUTURE_SKEW_MS - mins(1)) }).ok).toBe(true);
  });

  it("refuses a tap far in the past — a day cannot open six years ago", () => {
    expect(tap({ tap: "start_day", at: at(-MAX_BACKDATE_MS - mins(1)) }).ok).toBe(false);
  });

  it("allows a delayed tap within the window, for the retry after no signal", () => {
    expect(tap({ tap: "start_day", at: at(-hours(2)) }).ok).toBe(true);
  });

  it("bounds the AUTO-OPEN path too, not just the path with something running", () => {
    const res = planTap({
      tap: "arrived",
      open: null,
      at: new Date("2031-05-05T00:00:00.000Z"),
      jobId: JOB_A,
      now: NOW,
    });
    expect(res.ok).toBe(false);
  });
});

describe("backwards taps: skew is clamped, a real reversal is refused", () => {
  const open = openEntry("job", JOB_A, NOW);

  it("clamps a sub-minute backwards tap instead of failing the dispatch", () => {
    expect(tap({ tap: "done", open, at: at(-MAX_BACKWARDS_SKEW_MS + 1) }).ok).toBe(true);
  });

  it("refuses a genuinely backwards tap rather than inventing hours", () => {
    expect(tap({ tap: "done", open, at: at(-hours(1)) }).ok).toBe(false);
  });

  it("a clamped tap collapses to zero length rather than producing a negative row", () => {
    const plan = planOf(tap({ tap: "done", open, at: at(-1_000) }));
    expect(plan.discardOpen).toBe(true);
    expect(plan.close).toBeNull();
  });
});

describe("zero-length collapse", () => {
  it("six Dones in the same minute leave no junk rows", () => {
    let open: OpenEntry | null = openEntry("job", JOB_A, NOW);
    let rowsWritten = 0;
    for (let i = 0; i < 6; i += 1) {
      const plan = planOf(tap({ tap: "done", open, at: at(i * 1_000) }));
      if (plan.close !== null) rowsWritten += 1;
      open = plan.open ? { id: `row-${i}`, ...plan.open } : null;
    }
    expect(rowsWritten).toBe(0);
  });

  it("keeps the ORIGINAL start when it discards, so no worked minute is lost", () => {
    const open = openEntry("travel", JOB_A, NOW);
    const plan = planOf(tap({ tap: "arrived", open, at: at(30_000), jobId: JOB_A }));
    expect(plan.discardOpen).toBe(true);
    expect(plan.open?.startedAt).toEqual(open.startedAt);
  });

  it("closes normally once the tap lands in a later minute", () => {
    const open = openEntry("travel", JOB_A, NOW);
    const plan = planOf(tap({ tap: "arrived", open, at: at(mins(2)), jobId: JOB_A }));
    expect(plan.discardOpen).toBeUndefined();
    expect(plan.close).toMatchObject({ id: open.id });
  });
});

describe("job attribution", () => {
  it("Done clears the job — hours after it belong to no job until the tech says so", () => {
    const plan = planOf(tap({ tap: "done", open: openEntry("job", JOB_A) }));
    expect(plan.open).toMatchObject({ kind: "shop", jobId: null });
  });

  // The Done button lives on a job card, so the caller HAS the job id and will pass it. The job
  // must still be cleared: minutes after Done belong to no job until the tech says otherwise, and
  // carrying it forward would invent job-cost time nobody confirmed.
  it("Done clears the job even when the caller passes one", () => {
    const plan = planOf(tap({ tap: "done", open: openEntry("job", JOB_A), jobId: JOB_A }));
    expect(plan.open).toMatchObject({ kind: "shop", jobId: null });
  });

  it("End break clears the job even when the caller passes one", () => {
    const plan = planOf(tap({ tap: "end_break", open: openEntry("break", null), jobId: JOB_A }));
    expect(plan.open).toMatchObject({ kind: "shop", jobId: null });
  });

  it("End break resumes shop, not the interrupted job", () => {
    // Guessing they went back to the same job would invent job-cost minutes nobody confirmed.
    const plan = planOf(tap({ tap: "end_break", open: openEntry("break", null) }));
    expect(plan.open).toMatchObject({ kind: "shop", jobId: null });
  });

  it("resolves a legacy job row in the SHIFT lane back onto regular time", () => {
    // Days worked before job time moved to its own lane still hold job rows in the shift. Setting
    // off closes that row and the shift resumes as regular; the job itself is handled by
    // jobTargetFor, which the use case applies separately.
    const open = openEntry("job", JOB_A);
    const plan = planOf(tap({ tap: "enroute", open, at: at(mins(5)), jobId: JOB_B }));
    expect(plan.close).toMatchObject({ id: open.id });
    expect(plan.open).toMatchObject({ kind: "shop", jobId: null });
  });

  it("jobTargetFor opens the job that was tapped, and closes it on Done", () => {
    expect(jobTargetFor("arrived", JOB_B)).toEqual({ kind: "job", jobId: JOB_B });
    expect(jobTargetFor("enroute", JOB_B)).toEqual({ kind: "job", jobId: JOB_B });
    expect(jobTargetFor("done", null)).toBe(CLOSE_JOB);
  });

  it("a break and the end of the day both close the job — he is not on it", () => {
    // Leaving it open over lunch would charge the customer for his sandwich.
    expect(jobTargetFor("break", null)).toBe(CLOSE_JOB);
    expect(jobTargetFor("end_day", null)).toBe(CLOSE_JOB);
  });

  it("starting the day or ending a break says nothing about a job", () => {
    expect(jobTargetFor("start_day", null)).toBeNull();
    expect(jobTargetFor("end_break", null)).toBeNull();
  });

  it.each(["enroute", "arrived"] as const)("%s without a job is refused", (t) => {
    expect(tap({ tap: t, jobId: null }).ok).toBe(false);
  });

  it.each(["start_day", "break", "end_day"] as const)("%s carrying a job is refused", (t) => {
    expect(tap({ tap: t, jobId: JOB_A, open: openEntry("shop", null) }).ok).toBe(false);
  });
});

describe("planning never mutates the caller's data", () => {
  it("leaves the open entry's startedAt untouched", () => {
    const open = openEntry("job", JOB_A, NOW);
    // Capture the VALUE, not a shallow copy: a spread shares the same Date object, so toEqual
    // would compare a mutated Date to itself and pass.
    const startedMs = open.startedAt.getTime();

    planTap({ tap: "done", open, at: at(mins(30)), jobId: null, now: at(mins(30)) });

    expect(open.startedAt.getTime()).toBe(startedMs);
    expect(open.kind).toBe("job");
    expect(open.jobId).toBe(JOB_A);
  });

  it("leaves the tap instant untouched", () => {
    const tapAt = at(mins(30));
    const ms = tapAt.getTime();
    planTap({ tap: "done", open: openEntry("job", JOB_A), at: tapAt, jobId: null, now: tapAt });
    expect(tapAt.getTime()).toBe(ms);
  });
});
