import { describe, it, expect } from "vitest";
import { timeOffMinutes, amountProblem, HALF_DAY_DIVISOR } from "./time-off-amount";

/**
 * How much of a day off is being claimed — the one number a time-off row carries.
 *
 * A wrong value here is a wrong paycheque, so every refusal is a stated sentence rather than a
 * disabled button: the tech has to know WHY the day will not save.
 */

const FULL_DAY = 8 * 60;

describe("timeOffMinutes", () => {
  it("takes a full day from this person's own standard day, not a compiled-in eight hours", () => {
    // A 10-hour crew row means a full day off is TEN hours. Hardcoding 480 here would short
    // a four-tens technician two hours every time he takes a day.
    expect(timeOffMinutes({ amount: "full", standardMinutes: 600, customHours: "" })).toBe(600);
    expect(timeOffMinutes({ amount: "full", standardMinutes: FULL_DAY, customHours: "" })).toBe(480);
  });

  it("halves the same standard for a half day", () => {
    expect(timeOffMinutes({ amount: "half", standardMinutes: FULL_DAY, customHours: "" })).toBe(240);
    // 7.5h standard → 3h45. Whole minutes, because the column is an integer.
    expect(timeOffMinutes({ amount: "half", standardMinutes: 450, customHours: "" })).toBe(225);
  });

  it("cannot answer full or half on a day the shop has as a day off", () => {
    expect(timeOffMinutes({ amount: "full", standardMinutes: null, customHours: "" })).toBeNull();
    expect(timeOffMinutes({ amount: "half", standardMinutes: null, customHours: "" })).toBeNull();
  });

  it("converts typed hours to whole minutes", () => {
    expect(timeOffMinutes({ amount: "custom", standardMinutes: FULL_DAY, customHours: "8" })).toBe(480);
    expect(timeOffMinutes({ amount: "custom", standardMinutes: FULL_DAY, customHours: "7.5" })).toBe(450);
    expect(timeOffMinutes({ amount: "custom", standardMinutes: null, customHours: "4" })).toBe(240);
  });

  it("is null for typed hours that are not a number", () => {
    for (const bad of ["", " ", "abc", "-2", "0"]) {
      expect(timeOffMinutes({ amount: "custom", standardMinutes: FULL_DAY, customHours: bad })).toBeNull();
    }
  });

  it("exposes the half-day divisor rather than repeating a 2 at each call site", () => {
    expect(HALF_DAY_DIVISOR).toBe(2);
  });
});

describe("amountProblem", () => {
  it("is silent when the amount is a payable number", () => {
    expect(amountProblem({ amount: "full", standardMinutes: FULL_DAY, customHours: "" })).toBeNull();
    expect(amountProblem({ amount: "custom", standardMinutes: null, customHours: "6" })).toBeNull();
  });

  it("says a day off has no standard length, and points at the way out", () => {
    const problem = amountProblem({ amount: "full", standardMinutes: null, customHours: "" });
    expect(problem).toMatch(/day off/i);
    expect(problem, "a refusal with no next step is a dead end").toMatch(/hours/i);
  });

  it("refuses nothing typed", () => {
    expect(amountProblem({ amount: "custom", standardMinutes: FULL_DAY, customHours: "" })).toMatch(/how many hours/i);
  });

  it("refuses more than one day — the row is capped at 1440 minutes by the domain", () => {
    // A five-day holiday is five rows. Sending 40 hours would be refused by the server's shape
    // check as a transaction error; refusing it here says something a person can act on.
    const problem = amountProblem({ amount: "custom", standardMinutes: FULL_DAY, customHours: "40" });
    expect(problem).toMatch(/one day/i);
  });

  it("refuses zero and negative hours", () => {
    expect(amountProblem({ amount: "custom", standardMinutes: FULL_DAY, customHours: "0" })).not.toBeNull();
    expect(amountProblem({ amount: "custom", standardMinutes: FULL_DAY, customHours: "-3" })).not.toBeNull();
  });
});
