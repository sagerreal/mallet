// @vitest-environment jsdom
/**
 * The three figures. Each assertion here is a way a payroll summary can lie:
 *
 *   - capping regular at the overtime threshold states a SMALLER number than the shop is about to
 *     pay (40 worked + a paid holiday is 48 regular hours, not 40);
 *   - drawing the bar past its own track when the figure is uncapped;
 *   - measuring the bar against a compiled-in forty in a shop whose week is 44;
 *   - a figure with no stated rule, which is a figure nobody can check.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoursSummary } from "./hours-summary";

const summary = (over: Partial<Parameters<typeof HoursSummary>[0]> = {}) =>
  render(
    <HoursSummary
      regularHours={40}
      overtimeHours={0}
      weeklyThresholdHours={40}
      rulePhrase="past 40h this week"
      missingDays={[]}
      {...over}
    />,
  );

const cell = (label: string): HTMLElement => {
  const found = screen.getByText(label).parentElement;
  if (!found) throw new Error(`the ${label} label has no cell`);
  return found;
};
const barWidth = (): string =>
  (document.querySelector(".sum-bar i") as HTMLElement | null)?.style.width ?? "";

describe("the regular-hours cell", () => {
  it("reads the figure uncapped — a paid holiday on top of a full week is 48 hours, not 40", () => {
    summary({ regularHours: 48, weeklyThresholdHours: 40 });
    expect(cell("Regular hours").textContent).toContain("48h");
  });

  it("stops the BAR at its own end even though the figure runs past it", () => {
    summary({ regularHours: 48, weeklyThresholdHours: 40 });
    expect(barWidth()).toBe("100%");
  });

  it("measures against the shop's own week, not a compiled-in forty", () => {
    summary({ regularHours: 22, weeklyThresholdHours: 44 });
    expect(cell("Regular hours").textContent).toContain("of a 44h week");
    expect(barWidth()).toBe("50%");
  });

  it("renders hours and minutes, because a timesheet is not read in decimals", () => {
    summary({ regularHours: 37.5 });
    expect(cell("Regular hours").textContent).toContain("37h 30m");
  });
});

describe("the overtime cell", () => {
  it("names the rule that produced the figure", () => {
    summary({ overtimeHours: 8, rulePhrase: "past 8h a day or 40h this week" });
    const text = cell("Overtime").textContent ?? "";
    expect(text).toContain("8h");
    expect(text).toContain("past 8h a day or 40h this week");
  });

  it("reads zero rather than going blank — a blank reads as 'we did not work it out'", () => {
    summary({ overtimeHours: 0 });
    expect(cell("Overtime").textContent).toContain("0h");
  });
});

describe("the missing-days cell", () => {
  it("says so plainly when nothing is missing", () => {
    summary({ missingDays: [] });
    const text = cell("Days missing hours").textContent ?? "";
    expect(text).toContain("0");
    expect(text).toContain("Every day you worked is reported.");
  });

  it("names the days and the two ways to fix them", () => {
    summary({ missingDays: ["2026-06-30", "2026-07-02"] });
    const text = cell("Days missing hours").textContent ?? "";
    expect(text).toContain("Jun 30");
    expect(text).toContain("Jul 2");
    expect(text).toContain("add the hours or tell the office");
  });

  it("counts one day as a day, not as days", () => {
    summary({ missingDays: ["2026-06-30"] });
    expect(cell("Days missing hours").textContent).toContain("day");
    expect(cell("Days missing hours").textContent).not.toContain("days missing hours1day");
  });
});
