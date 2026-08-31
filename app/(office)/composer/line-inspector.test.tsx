// @vitest-environment jsdom
/**
 * app/(office)/composer/line-inspector.test.tsx
 *
 * The inspector rail, driven through LineTable the way a person drives it: click a row, read
 * its details, edit them. Tested through the table because selection IS the feature — an
 * inspector unit-tested in isolation would never catch a stale index docking the wrong line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { LineTable } from "./line-table";
import type { ComposerLine } from "./composer-state";

const onLines = vi.fn();
beforeEach(() => {
  onLines.mockClear();
  cleanup();
});

const fence: ComposerLine = { d: "Cedar privacy fence", q: 100, r: 0, unit: "LF" };
const posts: ComposerLine = {
  d: "Line posts",
  q: 14,
  r: 24.3,
  c: 18,
  unit: "ea",
  qtyExpr: "qty/8+1",
  roundUp: true,
  parentIndex: 0,
};

const table = (lines: ComposerLine[], opts: { sections?: string[]; taxed?: boolean } = {}) => {
  cleanup();
  return render(
    <LineTable
      lines={lines}
      sections={opts.sections ?? []}
      showCost={false}
      taxed={opts.taxed ?? false}
      onLines={onLines}
    />,
  );
};

const rail = () => screen.getByTestId("line-inspector");
const last = (): ComposerLine[] => onLines.mock.calls[onLines.mock.calls.length - 1]![0];
const select = (label: string) => fireEvent.click(screen.getByLabelText(label));

describe("selection", () => {
  it("shows no rail until a line is selected — the ledger takes the full width", () => {
    table([fence]);
    expect(screen.queryByTestId("line-inspector")).toBeNull();
    select("Description, line 1");
    expect(rail()).toBeTruthy();
  });

  it("docks the SELECTED line's details, and follows a reselect", () => {
    table([fence, { d: "Walk gate", q: 1, r: 425 }]);
    select("Description, line 1");
    expect(within(rail()).getByText("Cedar privacy fence")).toBeTruthy();
    select("Description, line 2");
    expect(within(rail()).getByText("Walk gate")).toBeTruthy();
  });

  it("clears the selection when the selected line is removed — never a stale index", () => {
    table([fence, { d: "Walk gate", q: 1, r: 425 }]);
    select("Description, line 2");
    fireEvent.click(screen.getByLabelText("Remove line 2"));
    expect(screen.queryByTestId("line-inspector")).toBeNull();
  });

  it("folds to the Details seam and comes back", () => {
    table([fence]);
    select("Description, line 1");
    fireEvent.click(screen.getByLabelText("Hide details"));
    expect(screen.queryByTestId("line-inspector")).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Show details")[0]!);
    expect(rail()).toBeTruthy();
  });
});

describe("what the rail says", () => {
  it("names an assembly, its driver and its parts", () => {
    table([fence, posts]);
    select("Description, line 1");
    expect(rail().querySelector(".rail-kicker")?.textContent).toBe("Assembly");
    expect(within(rail()).getByText("Driver quantity")).toBeTruthy();
    expect(within(rail()).getByText(/100 LF · 1 item/)).toBeTruthy();
    expect(within(rail()).getByText(/from items/)).toBeTruthy();
  });

  it("shows a component's math beside its computed count", () => {
    table([fence, posts]);
    select("Description, component 2");
    expect(within(rail()).getByText("Assembly item")).toBeTruthy();
    expect(within(rail()).getByText("qty/8+1 = 14 ea")).toBeTruthy();
    expect(within(rail()).getByText(/Inside Cedar privacy fence/)).toBeTruthy();
  });

  it("walks from the assembly to a part and back", () => {
    table([fence, posts]);
    select("Description, line 1");
    fireEvent.click(within(rail()).getByRole("button", { name: /^Assembly/ }));
    fireEvent.click(within(rail()).getByText("Line posts"));
    expect(within(rail()).getByText("Assembly item")).toBeTruthy();
    // The accordion stays open across the walk — "Go to assembly" is already on screen.
    fireEvent.click(within(rail()).getByText("Go to assembly"));
    expect(within(rail()).getByText("Driver quantity")).toBeTruthy();
  });
});

describe("what the rail edits", () => {
  it("toggles Round up from the component's quantity editor", () => {
    table([fence, { ...posts, roundUp: false, q: 13.5 }]);
    select("Description, component 2");
    fireEvent.click(within(rail()).getByText("Quantity").closest("button")!);
    fireEvent.click(within(rail()).getByRole("button", { name: "Round up" }));
    expect(last()[1]?.roundUp).toBe(true);
  });

  it("moves a line between sections, and out of them entirely", () => {
    table([{ d: "Repaint", q: 1, r: 1800, sectionIndex: 0 }], { sections: ["Interior", "Exterior"] });
    select("Description, line 1");
    fireEvent.click(within(rail()).getByText("Section").closest("button")!);
    fireEvent.change(within(rail()).getByLabelText("Section"), { target: { value: "1" } });
    expect(last()[0]?.sectionIndex).toBe(1);

    fireEvent.change(within(rail()).getByLabelText("Section"), { target: { value: "" } });
    expect("sectionIndex" in last()[0]!).toBe(false);
  });

  it("hides a line from the customer's copy, stated as Shown/Hidden", () => {
    table([fence]);
    select("Description, line 1");
    fireEvent.click(within(rail()).getByText("On customer copy").closest("button")!);
    expect(last()[0]?.hidden).toBe(true);
  });

  it("makes a line optional from More details", () => {
    table([{ d: "Stain & seal", q: 100, r: 3.25 }]);
    select("Description, line 1");
    fireEvent.click(within(rail()).getByText("More details").closest("button")!);
    fireEvent.click(within(rail()).getByRole("button", { name: "Required" }));
    expect(last()[0]?.opt).toBe(true);
  });

  it("edits scope in the rail's accordion", () => {
    table([fence]);
    select("Description, line 1");
    fireEvent.click(within(rail()).getByText("Scope").closest("button")!);
    fireEvent.change(within(rail()).getByLabelText("Scope"), {
      target: { value: "Includes: posts set in concrete." },
    });
    expect(last()[0]?.scope).toBe("Includes: posts set in concrete.");
  });

  it("offers Tax only on a component's parent — a part's money rides its parent", () => {
    table([fence, posts], { taxed: true });
    select("Description, component 2");
    expect(within(rail()).queryByText("Tax")).toBeNull();
    select("Description, line 1");
    expect(within(rail()).getByText("Tax")).toBeTruthy();
  });
});

describe("assembly collapse in the ledger", () => {
  it("folds an assembly to its subline and keeps its parts", () => {
    table([fence, posts, { d: "Walk gate", q: 1, r: 425 }]);
    fireEvent.click(screen.getByLabelText("Collapse assembly, line 1"));
    expect(screen.queryByLabelText("Description, component 2")).toBeNull();
    expect(screen.getByText(/Assembly · 1 item · 100 LF/)).toBeTruthy();
    // The parts are hidden, not gone.
    expect(last).toBeTruthy();
    expect(onLines).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Expand assembly, line 1"));
    expect(screen.getByLabelText("Description, component 2")).toBeTruthy();
  });

  it("shows no disclosure on a plain line — there is nothing to fold", () => {
    table([{ d: "Walk gate", q: 1, r: 425 }]);
    expect(screen.queryByLabelText(/Collapse assembly/)).toBeNull();
  });
});
