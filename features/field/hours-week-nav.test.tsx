// @vitest-environment jsdom
/**
 * The week pager. The word and the range are both load-bearing: the word is what a man thinks
 * ("last week"), the range is what makes him sure ("Jun 22 – Jun 28"). Showing only the word fails
 * three weeks back; showing only the range makes him count.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HoursWeekNav, weekWord, weekRange } from "./hours-week-nav";

const THIS_WEEK = "2026-06-29"; // the Monday of the globally-mocked today (2026-07-01, a Wednesday)

describe("weekWord", () => {
  it.each([
    ["2026-06-29", "This week"],
    ["2026-06-22", "Last week"],
    ["2026-07-06", "Next week"],
    ["2026-06-15", "2 weeks ago"],
    ["2026-07-13", "In 2 weeks"],
  ])("calls %s %s", (weekStartISO, expected) => {
    expect(weekWord(weekStartISO, THIS_WEEK)).toBe(expected);
  });

  it("gives up on words once they stop being faster to read than the dates", () => {
    // "9 weeks ago" is not a word anybody reads faster than "Apr 27 – May 3"; the range carries it.
    expect(weekWord("2026-04-27", THIS_WEEK)).toBe("9 weeks ago");
  });
});

describe("weekRange", () => {
  it("spans Monday to Sunday — the seven days the register below is showing", () => {
    expect(weekRange("2026-06-29")).toBe("Jun 29 – Jul 5");
  });
});

describe("the pager", () => {
  const nav = (weekStartISO: string) => {
    const onNav = vi.fn();
    const onThisWeek = vi.fn();
    render(
      <HoursWeekNav
        weekStartISO={weekStartISO}
        thisWeekISO={THIS_WEEK}
        onNav={onNav}
        onThisWeek={onThisWeek}
      />,
    );
    return { onNav, onThisWeek };
  };

  it("moves a whole week at a time, in both directions", () => {
    const { onNav } = nav(THIS_WEEK);
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(onNav.mock.calls).toEqual([[-1], [1]]);
  });

  it("hides the way back while he is already on this week", () => {
    nav(THIS_WEEK);
    expect(screen.queryByRole("button", { name: "Back to this week" })).toBeNull();
  });

  it("offers one tap back once he is away — four taps forward is how a man loses his place", () => {
    const { onThisWeek } = nav("2026-06-08");
    fireEvent.click(screen.getByRole("button", { name: "Back to this week" }));
    expect(onThisWeek).toHaveBeenCalledTimes(1);
  });

  it("names the week as a heading, so a reader arriving at the register knows which one it is", () => {
    nav("2026-06-22");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("Last week");
    expect(heading.textContent).toContain("Jun 22 – Jun 28");
  });
});
