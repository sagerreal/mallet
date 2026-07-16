// Unit tests for the pure callback detector. Every case from the brief is covered in order.
// No I/O, no DB — all data is constructed in-memory using real Date objects.
import { describe, it, expect } from "vitest";
import { asJobId } from "@mallet/shared/types";
import {
  detectCallbacks,
  refTimeOf,
  CALLBACK_WINDOW_DAYS,
  type JobLite,
} from "./detect-callbacks";

// ── test constants ───────────────────────────────────────────────────────────

const JID = (n: number) => asJobId(`00000000-0000-0000-0000-${String(n).padStart(12, "0")}`);

// A fixed anchor in time. All dates in tests are expressed relative to this.
const ANCHOR = new Date("2026-06-01T12:00:00Z");

/** Return a date that is `days` before ANCHOR. */
const daysBefore = (days: number): Date =>
  new Date(ANCHOR.getTime() - days * 24 * 60 * 60 * 1000);

/** Return a date that is `days` after ANCHOR. */
const daysAfter = (days: number): Date =>
  new Date(ANCHOR.getTime() + days * 24 * 60 * 60 * 1000);

// Minimal JobLite builders — spread to override fields, keeping tests terse.
const baseComplete = (
  id: ReturnType<typeof asJobId>,
  overrides?: Partial<JobLite>,
): JobLite => ({
  id,
  leadId: "lead-A",
  svc: "water heater",
  status: "complete",
  completedAt: daysBefore(10),
  scheduledStart: null,
  createdAt: daysBefore(12),
  callbackOf: null,
  ...overrides,
});

// The "later job" being evaluated as a potential callback.
const baseCallback = (
  id: ReturnType<typeof asJobId>,
  overrides?: Partial<JobLite>,
): JobLite => ({
  id,
  leadId: "lead-A",
  svc: "water heater",
  status: "scheduled",
  completedAt: null,
  scheduledStart: ANCHOR,
  createdAt: ANCHOR,
  callbackOf: null,
  ...overrides,
});

// ── refTimeOf ───────────────────────────────────────────────────────────────

describe("refTimeOf", () => {
  it("returns scheduledStart when it is set", () => {
    const job = { scheduledStart: ANCHOR, createdAt: daysBefore(5) };
    expect(refTimeOf(job)).toBe(ANCHOR);
  });

  it("falls back to createdAt when scheduledStart is null", () => {
    const createdAt = daysBefore(5);
    const job = { scheduledStart: null, createdAt };
    expect(refTimeOf(job)).toBe(createdAt);
  });
});

// ── CALLBACK_WINDOW_DAYS ─────────────────────────────────────────────────────

describe("CALLBACK_WINDOW_DAYS", () => {
  it("is 45", () => {
    expect(CALLBACK_WINDOW_DAYS).toBe(45);
  });
});

// ── detectCallbacks — core matching ─────────────────────────────────────────

describe("detectCallbacks — same customer + same service", () => {
  it("emits a candidate when original completed 10 days before the later job's refTime", () => {
    const original = baseComplete(JID(1));       // completedAt = 10 days before ANCHOR
    const later = baseCallback(JID(2));          // scheduledStart = ANCHOR → refTime = ANCHOR
    const results = detectCallbacks([original, later]);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });

  it("does NOT emit a candidate when original completed 60 days before (outside 45-day window)", () => {
    const original = baseComplete(JID(1), { completedAt: daysBefore(60) });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([original, later]);
    expect(results).toHaveLength(0);
  });

  it("pins the boundary: exactly 45 days is IN, one second past 45 days is OUT", () => {
    // refTime = ANCHOR (baseCallback.scheduledStart). daysBefore(45) is a gap of exactly 45 days →
    // inclusive → candidate. One second earlier is a gap of 45d+1s → excluded. This nails the off-by-one.
    const inAt45 = baseComplete(JID(1), { completedAt: daysBefore(45) });
    const later1 = baseCallback(JID(2));
    expect(detectCallbacks([inAt45, later1])).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);

    const justPast45 = baseComplete(JID(1), {
      completedAt: new Date(daysBefore(45).getTime() - 1000),
    });
    const later2 = baseCallback(JID(2));
    expect(detectCallbacks([justPast45, later2])).toHaveLength(0);
  });
});

// ── detectCallbacks — customer and service isolation ────────────────────────

describe("detectCallbacks — customer isolation", () => {
  it("does NOT emit a candidate when leadId differs (different customer)", () => {
    const original = baseComplete(JID(1), { leadId: "lead-B" });
    const later = baseCallback(JID(2), { leadId: "lead-A" });
    const results = detectCallbacks([original, later]);
    expect(results).toHaveLength(0);
  });
});

describe("detectCallbacks — service isolation", () => {
  it("does NOT emit a candidate when svc differs (different service)", () => {
    const original = baseComplete(JID(1), { svc: "drain cleaning" });
    const later = baseCallback(JID(2), { svc: "water heater" });
    const results = detectCallbacks([original, later]);
    expect(results).toHaveLength(0);
  });

  it("does NOT emit a candidate when both svc are null (null never matches)", () => {
    const original = baseComplete(JID(1), { svc: null });
    const later = baseCallback(JID(2), { svc: null });
    const results = detectCallbacks([original, later]);
    expect(results).toHaveLength(0);
  });
});

// ── detectCallbacks — case-insensitive + trim matching ──────────────────────

describe("detectCallbacks — case-insensitive + trim service match", () => {
  it("matches 'Water Heater ' (trailing space, mixed case) against 'water heater'", () => {
    const original = baseComplete(JID(1), { svc: "Water Heater " });
    const later = baseCallback(JID(2), { svc: "water heater" });
    const results = detectCallbacks([original, later]);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });

  it("matches 'WATER HEATER' against 'water heater'", () => {
    const original = baseComplete(JID(1), { svc: "WATER HEATER" });
    const later = baseCallback(JID(2), { svc: "water heater" });
    const results = detectCallbacks([original, later]);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });
});

// ── detectCallbacks — self-exclusion ─────────────────────────────────────────

describe("detectCallbacks — self-exclusion", () => {
  it("does NOT emit a job as a candidate of itself when it is complete", () => {
    // A single complete job with completedAt before its own refTime (which can happen if the
    // scheduledStart was earlier than completedAt, but we force them close here). The point is
    // the self-exclusion rule holds regardless.
    const solo = baseComplete(JID(1), {
      scheduledStart: ANCHOR,
      createdAt: daysBefore(5),
      completedAt: daysBefore(3),
    });
    const results = detectCallbacks([solo]);
    expect(results).toHaveLength(0);
  });
});

// ── detectCallbacks — already-flagged skip ───────────────────────────────────

describe("detectCallbacks — already-flagged skip", () => {
  it("skips a job that already has callbackOf set (it's confirmed/handled)", () => {
    const original = baseComplete(JID(1));
    const alreadyFlagged = baseCallback(JID(2), { callbackOf: JID(1) });
    const results = detectCallbacks([original, alreadyFlagged]);
    expect(results).toHaveLength(0);
  });
});

// ── detectCallbacks — canceled / non-complete exclusion ─────────────────────

describe("detectCallbacks — canceled / non-complete exclusion", () => {
  it("does NOT use a canceled job as an original (only status=complete qualifies)", () => {
    const canceled = baseComplete(JID(1), { status: "canceled" });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([canceled, later]);
    expect(results).toHaveLength(0);
  });

  it("does NOT use a scheduled job (non-complete) as an original", () => {
    const scheduled: JobLite = {
      ...baseComplete(JID(1)),
      status: "scheduled",
      completedAt: null, // no completedAt — not done
    };
    const later = baseCallback(JID(2));
    const results = detectCallbacks([scheduled, later]);
    expect(results).toHaveLength(0);
  });

  it("does NOT use a complete job that has no completedAt (missing timestamp) as an original", () => {
    // Defensive: status is 'complete' but completedAt is null — should still be excluded.
    const badOriginal: JobLite = { ...baseComplete(JID(1)), completedAt: null };
    const later = baseCallback(JID(2));
    const results = detectCallbacks([badOriginal, later]);
    expect(results).toHaveLength(0);
  });
});

// ── detectCallbacks — ties: most-recently-completed wins ─────────────────────

describe("detectCallbacks — tie-breaking", () => {
  it("picks the most-recently-completed original when two eligible originals exist", () => {
    // JID(1) completed 20 days before ANCHOR, JID(3) completed 5 days before — JID(3) wins.
    // Both originals are marked callbackOf so they're skipped as candidates themselves,
    // keeping the results array to exactly one entry (for JID(2)).
    const olderOriginal = baseComplete(JID(1), {
      completedAt: daysBefore(20),
      callbackOf: JID(99), // already-flagged → skipped as a candidate
    });
    const newerOriginal = baseComplete(JID(3), {
      completedAt: daysBefore(5),
      callbackOf: JID(99), // already-flagged → skipped as a candidate
    });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([olderOriginal, later, newerOriginal]);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(3) }]);
  });

  it("ties at exactly 45 days: the job is still within the window (inclusive boundary)", () => {
    // completedAt is exactly 45 days before refTime — must match.
    const original = baseComplete(JID(1), { completedAt: daysBefore(45) });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([original, later]);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });
});

// ── detectCallbacks — refTime fallback ───────────────────────────────────────

describe("detectCallbacks — refTime fallback to createdAt", () => {
  it("uses createdAt as refTime when scheduledStart is null", () => {
    // original completed 10 days before createdAt; later job has no scheduledStart.
    const createdAt = daysAfter(5);
    const original = baseComplete(JID(1), { completedAt: daysBefore(5) }); // 10 days before createdAt
    const later = baseCallback(JID(2), { scheduledStart: null, createdAt });
    const results = detectCallbacks([original, later]);
    // original completedAt = daysBefore(5) = ANCHOR - 5 days
    // later refTime = createdAt = ANCHOR + 5 days
    // difference = 10 days < 45 days → should match
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });

  it("uses scheduledStart over createdAt when both are present", () => {
    // scheduledStart is ANCHOR, createdAt is 50 days before ANCHOR
    // original completedAt is 10 days before ANCHOR → 10-day window gap → matches via scheduledStart
    const original = baseComplete(JID(1), { completedAt: daysBefore(10) });
    const later = baseCallback(JID(2), {
      scheduledStart: ANCHOR,
      createdAt: daysBefore(50),
    });
    const results = detectCallbacks([original, later]);
    // refTime = scheduledStart = ANCHOR; gap = 10 days → match
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });
});

// ── detectCallbacks — custom windowDays ──────────────────────────────────────

describe("detectCallbacks — custom windowDays parameter", () => {
  it("respects a caller-supplied windowDays that is smaller than the default", () => {
    // original is 10 days before, window is 5 days → no match
    const original = baseComplete(JID(1), { completedAt: daysBefore(10) });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([original, later], 5);
    expect(results).toHaveLength(0);
  });

  it("respects a caller-supplied windowDays that is larger than the default", () => {
    // original is 60 days before (outside default 45), but within caller's 90-day window
    const original = baseComplete(JID(1), { completedAt: daysBefore(60) });
    const later = baseCallback(JID(2));
    const results = detectCallbacks([original, later], 90);
    expect(results).toEqual([{ jobId: JID(2), originalJobId: JID(1) }]);
  });
});

// ── detectCallbacks — multi-customer isolation ────────────────────────────────

describe("detectCallbacks — multi-customer isolation", () => {
  it("only links jobs to originals from the same customer — no cross-customer match", () => {
    const origA = baseComplete(JID(1), { leadId: "lead-A" });
    const origB = baseComplete(JID(3), { leadId: "lead-B" });
    const laterA = baseCallback(JID(2), { leadId: "lead-A" });
    const laterB = baseCallback(JID(4), { leadId: "lead-B" });

    const results = detectCallbacks([origA, origB, laterA, laterB]);
    // Each later job should link to its own customer's original only.
    expect(results).toContainEqual({ jobId: JID(2), originalJobId: JID(1) });
    expect(results).toContainEqual({ jobId: JID(4), originalJobId: JID(3) });
    expect(results).toHaveLength(2);
  });
});

// ── detectCallbacks — empty / no match ───────────────────────────────────────

describe("detectCallbacks — empty inputs", () => {
  it("returns an empty array for an empty job list", () => {
    expect(detectCallbacks([])).toEqual([]);
  });

  it("returns an empty array when no job has an eligible original", () => {
    // Two scheduled jobs — neither is complete, neither can be an original.
    const a = baseCallback(JID(1));
    const b = baseCallback(JID(2), { leadId: "lead-B" });
    expect(detectCallbacks([a, b])).toEqual([]);
  });
});
