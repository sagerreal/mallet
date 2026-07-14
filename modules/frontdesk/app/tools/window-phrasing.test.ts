import { describe, it, expect } from "vitest";
import { windowRange } from "./window-phrasing";

// windowRange turns a validated "HH:MM" slot start into the spoken 2-hour arrival window, reusing
// windowEndHHMM so the range length is always the sanctioned SLOT_WINDOW_HOURS.
describe("windowRange", () => {
  it("speaks a morning window with an am end", () => {
    expect(windowRange("08:00")).toBe("between 8 and 10am");
  });

  it("speaks an afternoon window with a pm end", () => {
    expect(windowRange("14:00")).toBe("between 2 and 4pm");
  });

  it("speaks a midday window crossing noon with a pm end", () => {
    expect(windowRange("11:00")).toBe("between 11 and 1pm");
  });

  it("speaks a window ending exactly at noon as pm", () => {
    expect(windowRange("10:00")).toBe("between 10 and 12pm");
  });
});
