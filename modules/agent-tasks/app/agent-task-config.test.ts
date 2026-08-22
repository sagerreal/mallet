import { describe, it, expect } from "vitest";
import {
  TICK_CADENCE_MINUTES, MIN_STEP_MINUTES, MAX_STEP_DAYS, WAKE_BATCH, LEASE_MINUTES,
  MAX_ITERS_PER_WAKE, MAX_ATTEMPTS, MAX_STEPS_PER_TASK, MAX_TRANSCRIPT_BYTES,
  MAX_OPEN_TASKS_PER_ORG, TITLE_MAX, NOTE_MAX, TICK_BUDGET_MS, TICK_MAX_DURATION_SECONDS,
  REPLY_LEASE_MS, TRPC_MAX_DURATION_SECONDS,
} from "./agent-task-config";

describe("agent task config", () => {
  /**
   * NOT a restatement of the definition. `MIN_STEP_MINUTES = TICK_CADENCE_MINUTES * 2` and
   * `expect(MIN_STEP_MINUTES).toBeGreaterThanOrEqual(TICK_CADENCE_MINUTES * 2)` are the same
   * expression written twice — the assertion could not fail for any reason the source did not
   * already spell out. These two are the RELATIONSHIPS the number exists to hold, either of which a
   * plausible retuning of the multiplier could break:
   *
   *  - strictly MORE than one cadence, or a wake promised for exactly one cadence out can fall due
   *    inside the very window the current tick is still running in;
   *  - more than one whole tick's WALL CLOCK (TICK_BUDGET_MS), or the tick that was supposed to
   *    serve the promise is itself still working when the promise comes due.
   */
  it("never promises a wake the scheduler can still be busy missing", () => {
    expect(MIN_STEP_MINUTES).toBeGreaterThan(TICK_CADENCE_MINUTES);
    expect(MIN_STEP_MINUTES * 60_000).toBeGreaterThan(TICK_BUDGET_MS);
  });

  it("bounds a wake to a month", () => {
    expect(MAX_STEP_DAYS).toBe(30);
  });

  it("keeps one wake far below the interactive iteration cap of 15", () => {
    expect(MAX_ITERS_PER_WAKE).toBeLessThan(15);
  });

  // THE RELATIONSHIP THAT KEEPS TWO WAKES OFF ONE ROW. This assertion used to read
  // `LEASE_MINUTES <= TICK_CADENCE_MINUTES`, which encoded the defect rather than guarding it: at
  // LEASE == CADENCE == maxDuration/60 == 5, a wake still genuinely mid-turn lost its fence exactly
  // as the next tick fired, and that tick reclaimed the row. Two live wakes mint two different
  // tool_use ids, which neither the version guard nor the execution ledger dedupes — the customer
  // gets a second text. Both bounds are strict inequalities on purpose.
  it("holds a lease past the next tick AND past the whole-tick wall clock", () => {
    expect(LEASE_MINUTES).toBeGreaterThan(TICK_CADENCE_MINUTES);
    expect(LEASE_MINUTES * 60_000).toBeGreaterThan(TICK_MAX_DURATION_SECONDS * 1_000);
  });

  it("stops the tick before its own lease window and the platform ceiling close", () => {
    // The runner must run out of budget while it can still WRITE: before the platform kills it, and
    // before the lease it is holding expires.
    expect(TICK_BUDGET_MS).toBeLessThan(TICK_MAX_DURATION_SECONDS * 1_000);
    expect(TICK_BUDGET_MS).toBeLessThan(LEASE_MINUTES * 60_000);
    // And with enough of the window left to settle the task it abandons.
    expect(TICK_MAX_DURATION_SECONDS * 1_000 - TICK_BUDGET_MS).toBeGreaterThanOrEqual(30_000);
  });

  // The interactive fence: a `reply` killed at the platform ceiling must still be fenced for the
  // whole time it was actually running, or the runner reclaims the row mid-turn and two writers
  // append to one transcript. Strictly greater, so there is real margin rather than a tie.
  it("holds a reply's lease past the longest request that can hold it", () => {
    expect(REPLY_LEASE_MS).toBeGreaterThan(TRPC_MAX_DURATION_SECONDS * 1_000);
  });

  it("keeps the batch small enough for sequential dispatch on a max-10 pool", () => {
    expect(WAKE_BATCH).toBeLessThanOrEqual(5);
  });

  it("bounds runaway work and unbounded conversations", () => {
    expect(MAX_ATTEMPTS).toBe(5);
    expect(MAX_STEPS_PER_TASK).toBe(25);
    expect(MAX_TRANSCRIPT_BYTES).toBe(256_000);
    expect(MAX_OPEN_TASKS_PER_ORG).toBe(50);
  });

  it("bounds the strings a human sees", () => {
    expect(TITLE_MAX).toBe(120);
    expect(NOTE_MAX).toBe(280);
  });
});
