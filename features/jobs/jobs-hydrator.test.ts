/**
 * features/jobs/jobs-hydrator.test.ts
 * Unit tests for the pure time-conversion helpers and visit status mapping
 * exported from jobs-hydrator.tsx.
 */

import { describe, it, expect } from "vitest";
import { hhmmToHour, hoursBetween } from "./jobs-hydrator";

describe("hhmmToHour", () => {
  it("converts whole hours", () => {
    expect(hhmmToHour("09:00")).toBe(9);
    expect(hhmmToHour("14:00")).toBe(14);
    expect(hhmmToHour("00:00")).toBe(0);
  });

  it("converts half hours correctly", () => {
    expect(hhmmToHour("09:30")).toBe(9.5);
    expect(hhmmToHour("07:15")).toBe(7.25);
    expect(hhmmToHour("16:45")).toBeCloseTo(16.75);
  });

  it("returns 0 for null, undefined, and empty string", () => {
    expect(hhmmToHour(null)).toBe(0);
    expect(hhmmToHour(undefined)).toBe(0);
    expect(hhmmToHour("")).toBe(0);
  });

  it("returns 0 for malformed strings", () => {
    expect(hhmmToHour("bad")).toBe(0);
    expect(hhmmToHour("9")).toBe(0);
  });
});

describe("hoursBetween", () => {
  it("computes simple durations", () => {
    expect(hoursBetween("08:00", "10:00")).toBe(2);
    expect(hoursBetween("09:00", "11:30")).toBe(2.5);
  });

  it("uses defaultDur when both values are absent", () => {
    expect(hoursBetween(null, null)).toBe(2);
    expect(hoursBetween(null, null, 4)).toBe(4);
  });

  it("uses defaultDur when end is before or equal to start", () => {
    expect(hoursBetween("10:00", "09:00")).toBe(2);
    expect(hoursBetween("10:00", "10:00")).toBe(2);
  });

  it("uses defaultDur when only one value is missing", () => {
    // start present but no end → diff cannot be computed
    expect(hoursBetween("08:00", null)).toBe(2);
  });

  it("respects a custom defaultDur", () => {
    expect(hoursBetween(null, null, 3)).toBe(3);
    expect(hoursBetween("10:00", "09:00", 1)).toBe(1);
  });
});
