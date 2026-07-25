import { describe, it, expect } from "vitest";
import {
  dayClockView,
  optimisticView,
  hhmmLabel,
  sinceLabel,
  DAY_CLOCK_ACTIONS,
  type OpenEntryView,
} from "./day-clock-view";

const TODAY = "2026-07-01";

const entry = (over: Partial<OpenEntryView> = {}): OpenEntryView => ({
  kind: "shop",
  workDate: TODAY,
  startTime: "07:42",
  ...over,
});

describe("hhmmLabel", () => {
  it("renders a morning time in the field's short form", () => {
    expect(hhmmLabel("07:42")).toBe("7:42a");
  });

  it("renders an afternoon time with the p marker", () => {
    expect(hhmmLabel("12:05")).toBe("12:05p");
  });

  it("drops a zero minute", () => {
    expect(hhmmLabel("08:00")).toBe("8a");
  });

  it("renders midnight as 12a, not 0a", () => {
    expect(hhmmLabel("00:15")).toBe("12:15a");
  });

  it("returns an unparseable time untouched rather than rendering NaN on a payroll row", () => {
    expect(hhmmLabel("bogus")).toBe("bogus");
    expect(hhmmLabel("31:00")).toBe("31:00");
  });
});

describe("sinceLabel", () => {
  it("names only the time for a punch started today", () => {
    expect(sinceLabel(entry(), TODAY)).toBe("since 7:42a");
  });

  it("names the day too when the punch was left open from an earlier date", () => {
    const label = sinceLabel(entry({ workDate: "2026-06-30" }), TODAY);
    expect(label).toContain("7:42a");
    // The whole point: it must NOT read like an ordinary this-morning punch.
    expect(label).not.toBe("since 7:42a");
  });
});

describe("dayClockView — the three states", () => {
  it("is off the clock when nothing is running", () => {
    const view = dayClockView(null, TODAY);
    expect(view.state).toBe("off");
    expect(view.title).toBe("Off the clock");
    expect(view.since).toBe("");
  });

  it("is on the clock, with the start time, for a shop segment", () => {
    const view = dayClockView(entry(), TODAY);
    expect(view.state).toBe("on");
    expect(view.title).toBe("On the clock");
    expect(view.since).toBe("since 7:42a");
  });

  it("reads travel and on-site segments as simply on the clock", () => {
    expect(dayClockView(entry({ kind: "travel" }), TODAY).state).toBe("on");
    expect(dayClockView(entry({ kind: "job" }), TODAY).state).toBe("on");
  });

  it("is on break for a break segment", () => {
    const view = dayClockView(entry({ kind: "break", startTime: "12:05" }), TODAY);
    expect(view.state).toBe("break");
    expect(view.title).toBe("On break");
    expect(view.since).toBe("since 12:05p");
  });
});

describe("DAY_CLOCK_ACTIONS", () => {
  it("offers exactly one way onto the clock", () => {
    expect(DAY_CLOCK_ACTIONS.off.map((a) => a.tap)).toEqual(["start_day"]);
  });

  it("offers break and end day while running", () => {
    expect(DAY_CLOCK_ACTIONS.on.map((a) => a.tap)).toEqual(["break", "end_day"]);
  });

  it("offers only the way out of a break", () => {
    expect(DAY_CLOCK_ACTIONS.break.map((a) => a.tap)).toEqual(["end_break"]);
  });

  it("leaves no state without a way out — an inescapable state is unbounded paid hours", () => {
    for (const actions of Object.values(DAY_CLOCK_ACTIONS)) {
      expect(actions.length).toBeGreaterThan(0);
    }
  });
});

describe("optimisticView — what the row shows before the server answers", () => {
  const at = new Date(2026, 6, 1, 9, 5);

  it("puts Start day on the clock at the moment of the tap", () => {
    expect(optimisticView("start_day", at)).toEqual({
      state: "on",
      title: "On the clock",
      since: "since 9:05a",
    });
  });

  it("puts Break on break", () => {
    expect(optimisticView("break", at).state).toBe("break");
  });

  it("puts End break back on the clock", () => {
    expect(optimisticView("end_break", at).state).toBe("on");
  });

  it("takes End day off the clock, with no start time to show", () => {
    expect(optimisticView("end_day", at)).toEqual({
      state: "off",
      title: "Off the clock",
      since: "",
    });
  });
});
