import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  BATCH_MIN,
  BATCH_MAX,
  MAX_ATTEMPTS_MIN,
  MAX_ATTEMPTS_MAX,
} from "./relay-config";

describe("relay-config constants", () => {
  it("BATCH_SIZE is 50 rows per tick", () => {
    expect(BATCH_SIZE).toBe(50);
  });

  it("MAX_ATTEMPTS is 8 (poison-cap before a row becomes a dead-letter)", () => {
    expect(MAX_ATTEMPTS).toBe(8);
  });

  it("BATCH_MIN is 1 (smallest legal batch)", () => {
    expect(BATCH_MIN).toBe(1);
  });

  it("BATCH_MAX is 200 (largest legal batch)", () => {
    expect(BATCH_MAX).toBe(200);
  });

  it("MAX_ATTEMPTS_MIN is 1 (at least one attempt must be allowed)", () => {
    expect(MAX_ATTEMPTS_MIN).toBe(1);
  });

  it("MAX_ATTEMPTS_MAX is 20 (ceiling for configurable retries)", () => {
    expect(MAX_ATTEMPTS_MAX).toBe(20);
  });

  it("BATCH_SIZE falls within [BATCH_MIN, BATCH_MAX]", () => {
    expect(BATCH_SIZE).toBeGreaterThanOrEqual(BATCH_MIN);
    expect(BATCH_SIZE).toBeLessThanOrEqual(BATCH_MAX);
  });

  it("MAX_ATTEMPTS falls within [MAX_ATTEMPTS_MIN, MAX_ATTEMPTS_MAX]", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(MAX_ATTEMPTS_MIN);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(MAX_ATTEMPTS_MAX);
  });

  it("BATCH_MIN is strictly less than BATCH_MAX", () => {
    expect(BATCH_MIN).toBeLessThan(BATCH_MAX);
  });

  it("MAX_ATTEMPTS_MIN is strictly less than MAX_ATTEMPTS_MAX", () => {
    expect(MAX_ATTEMPTS_MIN).toBeLessThan(MAX_ATTEMPTS_MAX);
  });

  it("all constants are positive integers", () => {
    for (const [name, value] of Object.entries({
      BATCH_SIZE,
      MAX_ATTEMPTS,
      BATCH_MIN,
      BATCH_MAX,
      MAX_ATTEMPTS_MIN,
      MAX_ATTEMPTS_MAX,
    })) {
      expect(value, `${name} must be a positive integer`).toBeGreaterThan(0);
      expect(Number.isInteger(value), `${name} must be an integer`).toBe(true);
    }
  });
});
