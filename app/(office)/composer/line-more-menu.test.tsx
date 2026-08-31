// @vitest-environment jsdom
/**
 * app/(office)/composer/line-more-menu.test.tsx
 *
 * The footer's "More ▾" menu — the mock's grammar: the bar shows + Line item and ONE more
 * button. Several extras (caller tools, + Section, + Assembly) gather behind the menu; a lone
 * extra renders flat, because a one-item menu is a longer path to the same button.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { LineTable } from "./line-table";
import type { ComposerLine } from "./composer-state";

const onLines = vi.fn();
const onSections = vi.fn();
beforeEach(() => {
  onLines.mockClear();
  onSections.mockClear();
  cleanup();
});

const fence: ComposerLine = { d: "Cedar privacy fence", q: 100, r: 4.5 };
const last = (): ComposerLine[] => onLines.mock.calls[onLines.mock.calls.length - 1]![0];

const full = () =>
  render(
    <LineTable
      lines={[fence]}
      sections={[]}
      showCost={false}
      onLines={onLines}
      onSections={onSections}
      footerTools={<button type="button" className="lineedit-tool">From pricebook</button>}
    />,
  );

describe("when several extras exist", () => {
  it("gathers them behind More — the bar itself shows only + Line item and the menu", () => {
    full();
    expect(screen.queryByText("+ Section")).toBeNull();
    expect(screen.queryByText("From pricebook")).toBeNull();
    const more = screen.getByRole("button", { name: "More ▾" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("From pricebook")).toBeTruthy();
    expect(screen.getByText("+ Section")).toBeTruthy();
    expect(screen.getByText("+ Assembly")).toBeTruthy();
  });

  it("closes after a choice, and the choice lands", () => {
    full();
    fireEvent.click(screen.getByRole("button", { name: "More ▾" }));
    fireEvent.click(screen.getByText("+ Section"));
    expect(onSections).toHaveBeenCalledWith({ sections: ["Section 1"], lines: [fence] });
    expect(screen.queryByText("+ Section")).toBeNull();
  });

  it("closes on a press outside the menu", () => {
    full();
    fireEvent.click(screen.getByRole("button", { name: "More ▾" }));
    expect(screen.getByText("+ Assembly")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("+ Assembly")).toBeNull();
  });
});

describe("+ Assembly", () => {
  /** The table is controlled — the selection only means anything once the caller stores the
   *  new array, so this test holds the lines in state the way the composer does. */
  function Stored() {
    const [lines, setLines] = useState<ComposerLine[]>([fence]);
    return (
      <LineTable
        lines={lines}
        sections={[]}
        showCost={false}
        onLines={(next) => {
          onLines(next);
          setLines(next);
        }}
        onSections={onSections}
      />
    );
  }

  it("adds a blank parent with one blank component counted off its quantity, and selects it", () => {
    render(<Stored />);
    fireEvent.click(screen.getByRole("button", { name: "More ▾" }));
    fireEvent.click(screen.getByText("+ Assembly"));
    const next = last();
    expect(next).toHaveLength(3);
    expect(next[1]).toMatchObject({ d: "", q: 1 });
    expect(next[2]).toMatchObject({ d: "", parentIndex: 1, qtyExpr: "qty" });
    // The parent is selected — the rail docks with the driver-quantity teaching hint.
    expect(screen.getByTestId("line-inspector")).toBeTruthy();
    expect(screen.getByText("Driver quantity")).toBeTruthy();
  });
});

describe("when + Assembly is the only extra (the GBB tier bars)", () => {
  it("renders it flat — no one-item menu", () => {
    cleanup();
    render(<LineTable lines={[fence]} showCost={false} onLines={onLines} />);
    expect(screen.queryByRole("button", { name: "More ▾" })).toBeNull();
    fireEvent.click(screen.getByText("+ Assembly"));
    expect(last()).toHaveLength(3);
  });
});
