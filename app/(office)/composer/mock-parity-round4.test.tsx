// @vitest-environment jsdom
/**
 * app/(office)/composer/mock-parity-round4.test.tsx
 *
 * Round 4 of the 1:1 sweep — the mock behaviors the app was still missing: the always-present
 * rail, the row's scope preview, move up/down, the rail-title editor, the child rail's shape,
 * and the assembly's customer-detail choice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import { LineTable } from "./line-table";
import type { ComposerLine } from "./composer-state";

vi.mock("@/lib/store/upload-proposal-photo", () => ({
  uploadProposalPhoto: vi.fn(async () => "orgs/o1/proposal/abc.jpg"),
}));

const onLines = vi.fn();
beforeEach(() => {
  onLines.mockClear();
  cleanup();
});

const table = (lines: ComposerLine[]) =>
  render(<LineTable lines={lines} sections={[]} showCost={false} onLines={onLines} />);
const last = (): ComposerLine[] => onLines.mock.calls.at(-1)![0];
const rail = () => screen.getByTestId("line-inspector");

const fence: ComposerLine = { d: "Cedar fence", q: 100, r: 3.28, unit: "LF" };
const posts: ComposerLine = { d: "Line posts", q: 13, r: 24.3, c: 18, qtyExpr: "qty/8+1", parentIndex: 0 };

describe("the rail is always there", () => {
  it("teaches instead of vanishing when nothing is selected", () => {
    table([fence]);
    expect(
      screen.getByText("Select a line item to edit its pricing, cost, scope, and customer settings."),
    ).toBeTruthy();
  });

  it("still folds to the seam with nothing selected", () => {
    table([fence]);
    fireEvent.click(screen.getByLabelText("Hide details"));
    expect(screen.queryByText(/Select a line item/)).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Show details")[0]!);
    expect(screen.getByText(/Select a line item/)).toBeTruthy();
  });
});

describe("the row reads like the mock's", () => {
  it("shows the scope prose under the description", () => {
    table([{ ...fence, scope: "Includes: posts set in concrete." }]);
    expect(screen.getByText("Includes: posts set in concrete.")).toBeTruthy();
  });

  it("states an invalid quantity in the same slot", () => {
    table([fence, { ...posts, qtyExpr: "qty//8" }]);
    expect(screen.getByText("Check the quantity")).toBeTruthy();
  });
});

describe("move up / move down", () => {
  it("swaps two plain lines and disables at the ends", () => {
    table([{ d: "A", q: 1, r: 1 }, { d: "B", q: 1, r: 2 }]);
    const upA = screen.getByLabelText("Move A up") as HTMLButtonElement;
    const downB = screen.getByLabelText("Move B down") as HTMLButtonElement;
    expect(upA.disabled).toBe(true);
    expect(downB.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move A down"));
    expect(last().map((l) => l.d)).toEqual(["B", "A"]);
  });

  it("moves an assembly as a block, parts travelling, parentIndex remapped", () => {
    table([fence, posts, { d: "Gate", q: 1, r: 425 }]);
    fireEvent.click(screen.getByLabelText("Move Gate up"));
    const next = last();
    expect(next.map((l) => l.d)).toEqual(["Gate", "Cedar fence", "Line posts"]);
    expect(next[2]?.parentIndex).toBe(1);
  });

  it("moves a component only within its parent", () => {
    table([fence, posts, { d: "Rails", q: 3, r: 8, parentIndex: 0 }]);
    const up = screen.getByLabelText("Move Line posts up") as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move Line posts down"));
    expect(last().map((l) => l.d)).toEqual(["Cedar fence", "Rails", "Line posts"]);
  });
});

describe("the rail edits the description too", () => {
  it("opens the title as an editor, like the mock's c1-title-button", () => {
    table([fence]);
    fireEvent.click(screen.getByLabelText("Description, line 1"));
    fireEvent.click(within(rail()).getByRole("button", { name: "Cedar fence" }));
    fireEvent.change(within(rail()).getByLabelText("Description"), {
      target: { value: "Cedar privacy fence, 6 ft" },
    });
    expect(last()[0]?.d).toBe("Cedar privacy fence, 6 ft");
  });
});

describe("the child rail is lean", () => {
  it("carries no price or margin rows — cost and markup live in More details", () => {
    table([fence, posts]);
    fireEvent.click(screen.getByLabelText("Description, component 2"));
    expect(within(rail()).queryByText("Unit price")).toBeNull();
    expect(within(rail()).queryByText("Margin")).toBeNull();
    fireEvent.click(within(rail()).getByText("More details").closest("button")!);
    expect(within(rail()).getByLabelText("Unit cost")).toBeTruthy();
    expect(within(rail()).getByLabelText("Markup percent")).toBeTruthy();
    expect(within(rail()).getByRole("button", { name: "Duplicate item" })).toBeTruthy();
  });
});

describe("customer detail", () => {
  function Stored() {
    const [lines, setLines] = useState<ComposerLine[]>([fence, posts]);
    return (
      <LineTable
        lines={lines}
        sections={[]}
        showCost={false}
        onLines={(next) => {
          onLines(next);
          setLines(next);
        }}
      />
    );
  }

  it("flips summary → items from the assembly's More details, and back", () => {
    render(<Stored />);
    fireEvent.click(screen.getByLabelText("Description, line 1"));
    expect(within(rail()).getByText(/Customer summary/)).toBeTruthy();
    fireEvent.click(within(rail()).getByText("More details").closest("button")!);
    fireEvent.click(within(rail()).getByRole("button", { name: "Customer sees summary" }));
    expect(last()[0]?.custItems).toBe(true);
    expect(within(rail()).getByText(/Customer itemized/)).toBeTruthy();
    fireEvent.click(within(rail()).getByRole("button", { name: "Customer sees items" }));
    expect("custItems" in last()[0]!).toBe(false);
  });
});
