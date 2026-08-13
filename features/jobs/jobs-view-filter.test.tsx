// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobsViewFilter } from "./jobs-view-filter";

/**
 * The chip row itself. It is the Jobs list's ONLY filter and, since it came out of the Filters
 * disclosure, the only thing on the screen that says which slice is showing.
 */
const setup = (over: Partial<React.ComponentProps<typeof JobsViewFilter>> = {}) => {
  const onView = vi.fn();
  render(
    <JobsViewFilter
      view={null}
      counts={{ needsSlot: 13, late: 8, today: 20, week: 34, upcoming: 61, needsInvoice: 6, done: 12 }}
      onView={onView}
      {...over}
    />,
  );
  return { onView };
};

describe("JobsViewFilter", () => {
  it("offers every active band, Late among them, and never Archived", () => {
    // Archived is reached through the toolbar's set toggle. Offering the same state in two places
    // invites them to disagree.
    setup();
    // Label text with the count stripped — "Done" and "Done, not billed" both start with "Done",
    // so a per-label regex would match two buttons.
    const labels = screen
      .getAllByRole("button")
      .map((b) => (b.textContent ?? "").replace(/\s*\(\d+\)$/, "").trim());
    expect(labels).toEqual([
      "All", "Needs a slot", "Late", "Today", "This week", "Upcoming", "Done, not billed", "Done",
    ]);
  });

  it("carries the count on each chip, so you learn there are 8 late jobs without clicking", () => {
    setup();
    expect(screen.getByRole("button", { name: /^Late/ }).textContent).toContain("(8)");
  });

  it("omits a count while it is in flight rather than showing 0", () => {
    // A 0 that becomes 13 reads as data appearing from nowhere.
    setup({ counts: undefined });
    expect(screen.getByRole("button", { name: /^Late/ }).textContent).not.toContain("0");
  });

  it("marks the active chip pressed AND visually on", () => {
    // .chip.on had no CSS rule at all until this change — the component wrote .on and the
    // stylesheet only defined .chip.sel — so the selected chip was pixel-identical to the rest.
    setup({ view: "late" });
    const late = screen.getByRole("button", { name: /^Late/ });
    expect(late.getAttribute("aria-pressed")).toBe("true");
    expect(late.className.split(" ")).toContain("on");
    expect(screen.getByRole("button", { name: /^Today/ }).className.split(" ")).not.toContain("on");
  });

  it("marks All pressed when nothing is filtered", () => {
    setup({ view: null });
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("clears back to All by re-clicking the active chip", () => {
    // There is no Clear link any more: with the row visible, All IS the clear.
    const { onView } = setup({ view: "late" });
    fireEvent.click(screen.getByRole("button", { name: /^Late/ }));
    expect(onView).toHaveBeenCalledWith(null);
    expect(screen.queryByText("Clear")).toBeNull();
  });

  it("goes inert, not invisible, when the archived set owns the list", () => {
    setup({ disabled: true });
    expect(screen.getByRole("button", { name: /^Today/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "All" }).hasAttribute("disabled")).toBe(true);
  });
});
