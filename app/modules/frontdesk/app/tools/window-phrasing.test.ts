import { describe, it, expect } from "vitest";
import { startTimePhrase, windowRange } from "./window-phrasing";

// startTimePhrase turns a validated "HH:MM" slot start into the DISCRETE start time the caller hears
// ("8am", "noon", "4pm", "midnight") — the offer now leads with this, not a range.
describe("startTimePhrase", () => {
  it("words a morning start with am", () => {
    expect(startTimePhrase("08:00")).toBe("8am");
  });

  it("words an afternoon start with pm", () => {
    expect(startTimePhrase("16:00")).toBe("4pm");
    expect(startTimePhrase("14:00")).toBe("2pm");
  });

  it("words noon as 'noon', not '12pm'", () => {
    expect(startTimePhrase("12:00")).toBe("noon");
  });

  it("words midnight as 'midnight', not '12am'", () => {
    expect(startTimePhrase("00:00")).toBe("midnight");
  });

  it("words a single-digit afternoon hour naturally", () => {
    expect(startTimePhrase("13:00")).toBe("1pm");
    expect(startTimePhrase("11:00")).toBe("11am");
  });

  it("accepts an HH:MM:SS start (reads the hour)", () => {
    expect(startTimePhrase("09:00:00")).toBe("9am");
  });
});

// windowRange turns a validated "HH:MM" slot start into the spoken 2-hour arrival window, reusing
// windowEndHHMM so the range length is always the sanctioned SLOT_WINDOW_HOURS. Retained for the
// arrival-window mention / office task text.
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
