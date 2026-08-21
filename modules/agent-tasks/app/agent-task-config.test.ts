import { describe, it, expect } from "vitest";
import {
  TICK_CADENCE_MINUTES, MIN_STEP_MINUTES, MAX_STEP_DAYS, WAKE_BATCH, LEASE_MINUTES,
  MAX_ITERS_PER_WAKE, MAX_ATTEMPTS, MAX_STEPS_PER_TASK, MAX_TRANSCRIPT_BYTES,
  MAX_OPEN_TASKS_PER_ORG, TITLE_MAX, NOTE_MAX,
} from "./agent-task-config";

describe("agent task config", () => {
  it("never promises a wake sooner than the scheduler can serve", () => {
    expect(MIN_STEP_MINUTES).toBeGreaterThanOrEqual(TICK_CADENCE_MINUTES * 2);
  });

  it("bounds a wake to a month", () => {
    expect(MAX_STEP_DAYS).toBe(30);
  });

  it("keeps one wake far below the interactive iteration cap of 15", () => {
    expect(MAX_ITERS_PER_WAKE).toBeLessThan(15);
  });

  it("holds a lease longer than a wake but no longer than a tick gap", () => {
    expect(LEASE_MINUTES).toBeGreaterThan(0);
    expect(LEASE_MINUTES).toBeLessThanOrEqual(TICK_CADENCE_MINUTES);
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
