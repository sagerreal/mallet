import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import { planTap, type ClockPlan, type ClockState, type ClockTap, type OpenEntry } from "./clock";

const JOB_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OPEN_ID = "entry-open";

// Two instants in DIFFERENT minutes, so the matrix exercises ordinary transitions and never
// trips the zero-length collapse. Collapse gets its own describe block.
const STARTED = new Date("2026-07-24T15:00:00.000Z");
const LATER = new Date("2026-07-24T17:30:00.000Z");

const running = (kind: ClockState, jobId: string | null, startedAt: Date = STARTED): OpenEntry => ({
  id: OPEN_ID,
  kind,
  jobId,
  startedAt,
});

const planned = (
  tap: ClockTap,
  open: OpenEntry | null,
  at: Date,
  jobId: string | null,
): ClockPlan => {
  const r = planTap(tap, open, at, jobId);
  if (!isOk(r)) throw new Error(`expected a plan, got ${JSON.stringify(r.error)}`);
  return r.value;
};

const ALL_TAPS: readonly ClockTap[] = [
  "start_day",
  "enroute",
  "arrived",
  "done",
  "break",
  "end_break",
  "end_day",
];

const ALL_STATES: readonly (OpenEntry | null)[] = [
  null,
  running("shop", null),
  running("travel", JOB_A),
  running("job", JOB_A),
  running("break", null),
];

// ---------------------------------------------------------------------------
// The exhaustive matrix: every tap from every state.
// ---------------------------------------------------------------------------

type Expected = "writes nothing" | { readonly closes: boolean; readonly opens: { readonly kind: ClockState; readonly jobId: string | null } | null };

interface MatrixCase {
  readonly state: string;
  readonly open: OpenEntry | null;
  readonly tap: ClockTap;
  readonly jobId: string | null;
  readonly rule: string;
  readonly expected: Expected;
}

const shop = { kind: "shop", jobId: null } as const;
const breakSeg = { kind: "break", jobId: null } as const;
const travelA = { kind: "travel", jobId: JOB_A } as const;
const jobA = { kind: "job", jobId: JOB_A } as const;

const MATRIX: readonly MatrixCase[] = [
  // --- nothing running -----------------------------------------------------
  { state: "idle", open: null, tap: "start_day", jobId: null, rule: "opens shop time with no job", expected: { closes: false, opens: shop } },
  { state: "idle", open: null, tap: "enroute", jobId: JOB_A, rule: "auto-opens travel on the job without a prior start_day", expected: { closes: false, opens: travelA } },
  { state: "idle", open: null, tap: "arrived", jobId: JOB_A, rule: "auto-opens on-site job time without a prior start_day", expected: { closes: false, opens: jobA } },
  { state: "idle", open: null, tap: "done", jobId: null, rule: "auto-opens shop time rather than failing", expected: { closes: false, opens: shop } },
  { state: "idle", open: null, tap: "break", jobId: null, rule: "opens break time", expected: { closes: false, opens: breakSeg } },
  { state: "idle", open: null, tap: "end_break", jobId: null, rule: "writes nothing — no break to end", expected: "writes nothing" },
  { state: "idle", open: null, tap: "end_day", jobId: null, rule: "writes nothing — no day to end", expected: "writes nothing" },

  // --- shop running --------------------------------------------------------
  { state: "shop", open: running("shop", null), tap: "start_day", jobId: null, rule: "writes nothing — the day is already started", expected: "writes nothing" },
  { state: "shop", open: running("shop", null), tap: "enroute", jobId: JOB_A, rule: "closes shop time and opens travel on the job", expected: { closes: true, opens: travelA } },
  { state: "shop", open: running("shop", null), tap: "arrived", jobId: JOB_A, rule: "closes shop time and opens on-site job time", expected: { closes: true, opens: jobA } },
  { state: "shop", open: running("shop", null), tap: "done", jobId: null, rule: "writes nothing — shop time is already the resumed state", expected: "writes nothing" },
  { state: "shop", open: running("shop", null), tap: "break", jobId: null, rule: "closes shop time and opens break", expected: { closes: true, opens: breakSeg } },
  { state: "shop", open: running("shop", null), tap: "end_break", jobId: null, rule: "writes nothing — already back on shop time", expected: "writes nothing" },
  { state: "shop", open: running("shop", null), tap: "end_day", jobId: null, rule: "closes shop time and leaves the clock stopped", expected: { closes: true, opens: null } },

  // --- travel running ------------------------------------------------------
  { state: "travel", open: running("travel", JOB_A), tap: "start_day", jobId: null, rule: "closes travel and opens shop time", expected: { closes: true, opens: shop } },
  { state: "travel", open: running("travel", JOB_A), tap: "enroute", jobId: JOB_A, rule: "writes nothing — already en route to that job", expected: "writes nothing" },
  { state: "travel", open: running("travel", JOB_A), tap: "arrived", jobId: JOB_A, rule: "closes travel and opens on-site time on the same job", expected: { closes: true, opens: jobA } },
  { state: "travel", open: running("travel", JOB_A), tap: "done", jobId: null, rule: "closes travel and resumes shop time with no job", expected: { closes: true, opens: shop } },
  { state: "travel", open: running("travel", JOB_A), tap: "break", jobId: null, rule: "closes travel and opens break", expected: { closes: true, opens: breakSeg } },
  { state: "travel", open: running("travel", JOB_A), tap: "end_break", jobId: null, rule: "closes travel and returns to shop time", expected: { closes: true, opens: shop } },
  { state: "travel", open: running("travel", JOB_A), tap: "end_day", jobId: null, rule: "closes travel and leaves the clock stopped", expected: { closes: true, opens: null } },

  // --- job running ---------------------------------------------------------
  { state: "job", open: running("job", JOB_A), tap: "start_day", jobId: null, rule: "closes job time and opens shop time", expected: { closes: true, opens: shop } },
  { state: "job", open: running("job", JOB_A), tap: "enroute", jobId: JOB_A, rule: "closes job time and opens travel on the same job", expected: { closes: true, opens: travelA } },
  { state: "job", open: running("job", JOB_A), tap: "arrived", jobId: JOB_A, rule: "writes nothing — already on site at that job", expected: "writes nothing" },
  { state: "job", open: running("job", JOB_A), tap: "done", jobId: null, rule: "closes job time and resumes shop time with no job", expected: { closes: true, opens: shop } },
  { state: "job", open: running("job", JOB_A), tap: "break", jobId: null, rule: "interrupts job time and opens break", expected: { closes: true, opens: breakSeg } },
  { state: "job", open: running("job", JOB_A), tap: "end_break", jobId: null, rule: "closes job time and returns to shop time", expected: { closes: true, opens: shop } },
  { state: "job", open: running("job", JOB_A), tap: "end_day", jobId: null, rule: "closes job time and leaves the clock stopped", expected: { closes: true, opens: null } },

  // --- break running -------------------------------------------------------
  { state: "break", open: running("break", null), tap: "start_day", jobId: null, rule: "closes break and opens shop time", expected: { closes: true, opens: shop } },
  { state: "break", open: running("break", null), tap: "enroute", jobId: JOB_A, rule: "closes break and opens travel on the job", expected: { closes: true, opens: travelA } },
  { state: "break", open: running("break", null), tap: "arrived", jobId: JOB_A, rule: "closes break and opens on-site job time", expected: { closes: true, opens: jobA } },
  { state: "break", open: running("break", null), tap: "done", jobId: null, rule: "closes break and resumes shop time", expected: { closes: true, opens: shop } },
  { state: "break", open: running("break", null), tap: "break", jobId: null, rule: "writes nothing — already on break", expected: "writes nothing" },
  { state: "break", open: running("break", null), tap: "end_break", jobId: null, rule: "closes break and resumes shop time with no job", expected: { closes: true, opens: shop } },
  { state: "break", open: running("break", null), tap: "end_day", jobId: null, rule: "closes break and leaves the clock stopped", expected: { closes: true, opens: null } },
];

describe("planTap — every tap from every state has one defined outcome", () => {
  it("covers all 5 states x 7 taps with no gaps", () => {
    // Guards the table itself: a new tap or state must be planned here, not silently untested.
    expect(MATRIX).toHaveLength(ALL_STATES.length * ALL_TAPS.length);
  });

  it.each(MATRIX)("from $state, $tap $rule", ({ open, tap, jobId, expected }) => {
    const plan = planned(tap, open, LATER, jobId);

    if (expected === "writes nothing") {
      expect(plan).toEqual({ close: null, open: null, noop: true });
      return;
    }
    expect(plan.noop).toBe(false);
    expect(plan.close).toEqual(expected.closes ? { id: OPEN_ID, endedAt: LATER } : null);
    expect(plan.open).toEqual(expected.opens === null ? null : { ...expected.opens, startedAt: LATER });
  });
});

describe("planTap — a tap repeated on the state it produces writes nothing", () => {
  const repeats: readonly { readonly tap: ClockTap; readonly open: OpenEntry | null; readonly jobId: string | null }[] = [
    { tap: "start_day", open: running("shop", null), jobId: null },
    { tap: "enroute", open: running("travel", JOB_A), jobId: JOB_A },
    { tap: "arrived", open: running("job", JOB_A), jobId: JOB_A },
    { tap: "done", open: running("shop", null), jobId: null },
    { tap: "break", open: running("break", null), jobId: null },
    { tap: "end_break", open: running("shop", null), jobId: null },
    { tap: "end_day", open: null, jobId: null },
  ];

  it.each(repeats)("a second $tap produces no duplicate row", ({ tap, open, jobId }) => {
    const plan = planned(tap, open, LATER, jobId);
    expect(plan.noop).toBe(true);
    expect(plan.close).toBeNull();
    expect(plan.open).toBeNull();
  });

  it("a different job on the same kind is a real move, not a repeat", () => {
    const plan = planned("enroute", running("travel", JOB_A), LATER, JOB_B);
    expect(plan.noop).toBe(false);
    expect(plan.close).toEqual({ id: OPEN_ID, endedAt: LATER });
    expect(plan.open).toEqual({ kind: "travel", jobId: JOB_B, startedAt: LATER });
  });
});

// ---------------------------------------------------------------------------
// Zero-length collapse — the six-Dones-at-6pm case.
// ---------------------------------------------------------------------------

interface Row {
  readonly id: string;
  readonly kind: ClockState;
  readonly jobId: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

// Minimal stand-in for the repository write, so the test asserts on the ROWS a tech would end
// up with rather than on the plan shape. Immutable, like the real store writes.
const applyPlan = (rows: readonly Row[], plan: ClockPlan, newId: string): readonly Row[] => {
  if (plan.noop) return rows;
  const kept = plan.discardOpen === true ? rows.filter((r) => r.endedAt !== null) : rows;
  const close = plan.close;
  const closed =
    close === null ? kept : kept.map((r) => (r.id === close.id ? { ...r, endedAt: close.endedAt } : r));
  const opened = plan.open;
  return opened === null ? closed : [...closed, { id: newId, ...opened, endedAt: null }];
};

const openRow = (rows: readonly Row[]): OpenEntry | null => {
  const found = rows.find((r) => r.endedAt === null);
  return found === undefined
    ? null
    : { id: found.id, kind: found.kind, jobId: found.jobId, startedAt: found.startedAt };
};

const at = (hhmmss: string): Date => new Date(`2026-07-24T${hhmmss}.000Z`);

describe("planTap — taps inside one minute never leave a zero-length row", () => {
  it("six Dones tapped at 6pm from the truck leave no junk rows", () => {
    const taps: readonly { readonly tap: ClockTap; readonly at: Date; readonly jobId: string | null }[] = [
      { tap: "arrived", at: at("15:00:00"), jobId: JOB_A },
      { tap: "done", at: at("18:00:05"), jobId: null },
      { tap: "done", at: at("18:00:12"), jobId: null },
      { tap: "done", at: at("18:00:20"), jobId: null },
      { tap: "enroute", at: at("18:00:31"), jobId: JOB_B },
      { tap: "arrived", at: at("18:00:44"), jobId: JOB_B },
      { tap: "done", at: at("18:00:52"), jobId: null },
      { tap: "end_day", at: at("18:05:00"), jobId: null },
    ];

    const rows = taps.reduce<readonly Row[]>(
      (acc, t, i) => applyPlan(acc, planned(t.tap, openRow(acc), t.at, t.jobId), `row-${i}`),
      [],
    );

    // The eight taps describe exactly two real spans: the job, then the shop time after it.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.endedAt !== null)).toBe(true);
    expect(rows.every((r) => r.endedAt !== null && r.endedAt.getTime() > r.startedAt.getTime())).toBe(true);
    expect(rows.map((r) => r.kind)).toEqual(["job", "shop"]);
  });

  it("discards the collapsed row instead of closing it", () => {
    const plan = planned("arrived", running("travel", JOB_A, at("18:00:05")), at("18:00:40"), JOB_A);
    expect(plan.discardOpen).toBe(true);
    expect(plan.close).toBeNull();
  });

  it("keeps the original start instant so the span is not shortened", () => {
    const started = at("18:00:05");
    const plan = planned("arrived", running("travel", JOB_A, started), at("18:00:40"), JOB_A);
    expect(plan.open).toEqual({ kind: "job", jobId: JOB_A, startedAt: started });
  });

  it("end_day inside the opening minute leaves nothing behind at all", () => {
    const plan = planned("end_day", running("shop", null, at("18:00:05")), at("18:00:50"), null);
    expect(plan.discardOpen).toBe(true);
    expect(plan.close).toBeNull();
    expect(plan.open).toBeNull();
    expect(plan.noop).toBe(false);
  });

  it("a tap in the next minute closes the row normally", () => {
    const plan = planned("arrived", running("travel", JOB_A, at("18:00:59")), at("18:01:00"), JOB_A);
    expect(plan.discardOpen).toBeUndefined();
    expect(plan.close).toEqual({ id: OPEN_ID, endedAt: at("18:01:00") });
  });
});

// ---------------------------------------------------------------------------
// Breaks.
// ---------------------------------------------------------------------------

describe("planTap — a break interrupts anything and resumes to shop", () => {
  it("interrupts running job time", () => {
    const plan = planned("break", running("job", JOB_A), LATER, null);
    expect(plan.close).toEqual({ id: OPEN_ID, endedAt: LATER });
    expect(plan.open).toEqual({ kind: "break", jobId: null, startedAt: LATER });
  });

  it("resumes shop time, not the interrupted job", () => {
    // Guessing the tech went back to the same job would invent job-cost data nobody confirmed.
    const plan = planned("end_break", running("break", null), LATER, null);
    expect(plan.open).toEqual({ kind: "shop", jobId: null, startedAt: LATER });
  });

  it("never carries the job forward through done", () => {
    const plan = planned("done", running("job", JOB_A), LATER, null);
    expect(plan.open).toEqual({ kind: "shop", jobId: null, startedAt: LATER });
  });
});

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

describe("planTap — the domain does not trust the device clock", () => {
  it("refuses a tap dated before the running entry started", () => {
    const r = planTap("done", running("job", JOB_A, at("15:00:00")), at("14:59:00"), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("at");
  });

  it("refuses a tap whose time is not a real date", () => {
    const r = planTap("start_day", null, new Date("not-a-date"), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("at");
  });

  it("accepts a tap in the same instant as the start (collapse, not backwards)", () => {
    const started = at("15:00:00");
    const r = planTap("done", running("job", JOB_A, started), started, null);
    expect(isOk(r)).toBe(true);
  });
});

describe("planTap — job taps must name a job and non-job taps must not", () => {
  const missing: readonly ClockTap[] = ["enroute", "arrived"];
  it.each(missing)("refuses %s without a jobId", (tap) => {
    const r = planTap(tap, null, LATER, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("jobId");
  });

  it.each(missing)("refuses %s with a blank jobId", (tap) => {
    const r = planTap(tap, null, LATER, "   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("jobId");
  });

  const stray: readonly ClockTap[] = ["start_day", "break", "end_day"];
  it.each(stray)("refuses a stray jobId on %s", (tap) => {
    const r = planTap(tap, running("job", JOB_A), LATER, JOB_A);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("jobId");
  });

  it("tolerates the jobId a Done button knows, and still resumes shop with no job", () => {
    const plan = planned("done", running("job", JOB_A), LATER, JOB_A);
    expect(plan.open).toEqual({ kind: "shop", jobId: null, startedAt: LATER });
  });

  it("refuses a tap it does not know", () => {
    const r = planTap("lunch" as ClockTap, null, LATER, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("tap");
  });
});

// ---------------------------------------------------------------------------
// Totality.
// ---------------------------------------------------------------------------

describe("planTap — a tap can never throw, because dispatch runs in the same transaction", () => {
  it("returns a Result for every tap x state x jobId combination", () => {
    const jobIds: readonly (string | null)[] = [null, JOB_A, JOB_B, ""];
    for (const tap of ALL_TAPS) {
      for (const state of ALL_STATES) {
        for (const jobId of jobIds) {
          expect(() => planTap(tap, state, LATER, jobId)).not.toThrow();
          const r = planTap(tap, state, LATER, jobId);
          // Either an actionable plan or a named validation failure — never undefined behaviour.
          expect(typeof r.ok).toBe("boolean");
        }
      }
    }
  });

  it("does not throw on malformed input a JS caller could pass", () => {
    const junk = [undefined, null, 0, "nope", {}] as unknown as ClockTap[];
    for (const tap of junk) {
      expect(() => planTap(tap, running("job", JOB_A), LATER, JOB_A)).not.toThrow();
    }
    expect(() => planTap("done", running("job", JOB_A), "18:00" as unknown as Date, null)).not.toThrow();
    expect(() =>
      planTap("done", { ...running("job", JOB_A), startedAt: "nope" as unknown as Date }, LATER, null),
    ).not.toThrow();
    expect(() => planTap("enroute", null, LATER, 7 as unknown as string)).not.toThrow();
  });

  it("leaves the running entry untouched", () => {
    // Immutability: planning is a pure read of the open entry.
    const open = running("job", JOB_A);
    const snapshot = { ...open };
    planTap("done", open, LATER, null);
    expect(open).toEqual(snapshot);
  });
});
