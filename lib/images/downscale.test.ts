import { describe, it, expect } from "vitest";
import { fitWithin } from "./downscale";

describe("fitWithin", () => {
  it("returns original dimensions when both edges are within the cap", () => {
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });

  it("returns original dimensions when dimensions exactly equal maxEdge", () => {
    expect(fitWithin(1568, 1568, 1568)).toEqual({ width: 1568, height: 1568 });
  });

  it("scales down a landscape image by longest edge (width)", () => {
    const result = fitWithin(3136, 2352, 1568);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(1176); // 2352 * (1568/3136) = 1176
  });

  it("scales down a portrait image by longest edge (height)", () => {
    const result = fitWithin(2352, 3136, 1568);
    expect(result.width).toBe(1176);
    expect(result.height).toBe(1568);
  });

  it("scales down a square image", () => {
    const result = fitWithin(4000, 4000, 1568);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(1568);
  });

  it("applies rounding to both dimensions", () => {
    // 1000 × 999, maxEdge 1568 — both are within cap, returned as-is
    const same = fitWithin(1000, 999, 1568);
    expect(same).toEqual({ width: 1000, height: 999 });

    // 2000 × 1999, maxEdge 1568 → scale = 1568/2000 = 0.784
    const scaled = fitWithin(2000, 1999, 1568);
    expect(scaled.width).toBe(1568); // 2000 * 0.784 = 1568 exactly
    expect(scaled.height).toBe(Math.round(1999 * 0.784)); // 1567
  });

  it("handles 1×1 images", () => {
    expect(fitWithin(1, 1, 1568)).toEqual({ width: 1, height: 1 });
  });

  it("handles extreme aspect ratios (panoramic)", () => {
    const result = fitWithin(8000, 400, 1568);
    expect(result.width).toBe(1568);
    expect(result.height).toBe(Math.round(400 * (1568 / 8000))); // 78
  });

  it("handles extreme aspect ratios (very tall portrait)", () => {
    const result = fitWithin(400, 8000, 1568);
    expect(result.width).toBe(Math.round(400 * (1568 / 8000)));
    expect(result.height).toBe(1568);
  });
});
