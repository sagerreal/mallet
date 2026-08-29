// @vitest-environment jsdom
/**
 * app/(office)/composer/line-table.test.tsx
 *
 * Assemblies in the editor: a line priced from the components beneath it.
 *
 * These are the interactions where a wrong answer moves money — a component counted off the
 * wrong driver, a parent priced from the wrong parts, or a removal that re-parents someone
 * else's components. The arithmetic itself is covered in line-math.test.ts; what is tested here
 * is that the table wires it up and hands the caller a finished array.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { LineTable } from "./line-table";
import type { ComposerLine } from "./composer-state";

const onLines = vi.fn();
beforeEach(() => {
  onLines.mockClear();
  onSections.mockClear();
  cleanup();
});

const fence: ComposerLine = { d: "Cedar privacy fence", q: 100, r: 0, unit: "LF" };
const posts: ComposerLine = {
  d: "Line posts",
  q: 14,
  r: 24.3,
  c: 18,
  qtyExpr: "qty/8+1",
  roundUp: true,
  parentIndex: 0,
};

/** Renders fresh each time, so re-rendering with what the table handed back is one call. */
const onSections = vi.fn();

const table = (lines: ComposerLine[], showCost = false, sections: string[] = []) => {
  cleanup();
  return render(
    <LineTable
      lines={lines}
      sections={sections}
      showCost={showCost}
      onLines={onLines}
      onSections={onSections}
    />,
  );
};

/** What the table handed back on the last section change. */
const lastSections = () => onSections.mock.calls[onSections.mock.calls.length - 1]![0];

/** The array the table handed back on the last call. */
const lastLines = (): ComposerLine[] => onLines.mock.calls[onLines.mock.calls.length - 1]![0];

/** jest-dom is not loaded here — read the element and assert on it directly. */
const input = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;

describe("LineTable — building an assembly", () => {
  it("adds a component seeded with the driver, directly beneath its parent", () => {
    table([fence, { d: "Trip charge", q: 1, r: 95 }]);
    fireEvent.click(screen.getAllByTitle("Price this line from the parts and labour under it")[0]!);
    const next = lastLines();
    expect(next.map((l) => l.d)).toEqual(["Cedar privacy fence", "", "Trip charge"]);
    // Seeded with `qty` rather than blank: the estimator is shown the variable, not told about it.
    expect(next[1]).toMatchObject({ parentIndex: 0, qtyExpr: "qty" });
  });

  it("offers no component button on a component — the document stays one level deep", () => {
    table([fence, posts]);
    expect(screen.getAllByTitle("Price this line from the parts and labour under it")).toHaveLength(1);
  });

  it("counts the components it already has", () => {
    table([fence, posts]);
    expect(screen.getByText("↳ Add component (1)")).toBeTruthy();
  });
});

describe("LineTable — a component's quantity is math", () => {
  it("shows what the math resolved to, next to the math itself", () => {
    table([fence, posts]);
    expect(input("Quantity or math, component 2").value).toBe("qty/8+1");
    expect(screen.getByText("= 14")).toBeTruthy();
  });

  it("stores the typed expression AND the number it produced", () => {
    table([fence, posts]);
    fireEvent.change(input("Quantity or math, component 2"), { target: { value: "qty/4" } });
    expect(lastLines()[1]).toMatchObject({ qtyExpr: "qty/4", q: 25 });
  });

  it("says so when the math does not resolve, and prices nothing off it", () => {
    table([fence, posts]);
    fireEvent.change(input("Quantity or math, component 2"), { target: { value: "qty/" } });
    // Re-render with what the table handed back — this is what the caller would store.
    table(lastLines());
    expect(screen.getByText("Check the math")).toBeTruthy();
    expect(input("Quantity or math, component 2").getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the expression when a plain number is typed", () => {
    // An ordinary line must never carry an expression — its wire shape stays what it was.
    table([fence, posts]);
    fireEvent.change(input("Quantity or math, component 2"), { target: { value: "20" } });
    expect(lastLines()[1]?.qtyExpr).toBeUndefined();
    expect(lastLines()[1]?.q).toBe(20);
  });

  it("recounts every component when the driver changes", () => {
    table([fence, posts]);
    fireEvent.change(input("Quantity, line 1"), { target: { value: "200" } });
    // 200/8+1 = 26 posts, and the parent reprices off them.
    expect(lastLines()[1]?.q).toBe(14); // the component's own stored number is untouched…
    table(lastLines());
    expect(screen.getByText("= 26")).toBeTruthy(); // …but what it resolves to follows the driver
  });
});

describe("LineTable — the parent is priced by its parts", () => {
  it("rolls the components up into the parent's rate and does not offer a price field", () => {
    table([fence, posts]);
    fireEvent.change(input("Price, line 2"), { target: { value: "24.30" } });
    const rolled = lastLines()[0]!;
    // 14 posts × $24.30 = $340.20 over a 100 LF run → $3.40 a foot.
    expect(rolled.r).toBe(3.4);
    table(lastLines());
    expect(screen.queryByLabelText("Price, line 1")).toBeNull();
    expect(screen.getByLabelText("Price, line 1 — set by its components")).toBeTruthy();
  });

  it("rolls the components' cost up too", () => {
    table([fence, posts], true);
    fireEvent.change(input("Your cost, line 2"), { target: { value: "20" } });
    // 14 × $20 = $280 over 100 LF → $2.80 a foot.
    expect(lastLines()[0]?.c).toBe(2.8);
  });

  it("leaves a plain line's own price field alone", () => {
    table([{ d: "Trip charge", q: 1, r: 95 }]);
    expect(input("Price, line 1").value).toBe("95");
  });
});

describe("LineTable — removing", () => {
  it("takes an assembly's components with the parent", () => {
    table([fence, posts, { d: "Trip charge", q: 1, r: 95 }]);
    fireEvent.click(screen.getByLabelText("Remove line 1"));
    expect(lastLines().map((l) => l.d)).toEqual(["Trip charge"]);
  });

  it("keeps a later assembly's components pointed at their own parent", () => {
    // The defect: a plain filter leaves the gate's component pointing at whatever line slid
    // into its index — the component's money moves to another assembly.
    table([fence, posts, { d: "Gate", q: 1, r: 400 }, { d: "Hinges", q: 2, r: 30, parentIndex: 2 }]);
    fireEvent.click(screen.getByLabelText("Remove line 1"));
    const next = lastLines();
    expect(next.map((l) => l.d)).toEqual(["Gate", "Hinges"]);
    expect(next[next[1]!.parentIndex!]?.d).toBe("Gate");
  });
});

describe("LineTable — the unit", () => {
  it("keeps the unit the quantity is counted in", () => {
    table([fence]);
    expect(input("Unit, line 1").value).toBe("LF");
    fireEvent.change(input("Unit, line 1"), { target: { value: "ft" } });
    expect(lastLines()[0]?.unit).toBe("ft");
  });

  it("drops the unit entirely when it is cleared, rather than storing an empty string", () => {
    table([fence]);
    fireEvent.change(input("Unit, line 1"), { target: { value: "" } });
    expect(lastLines()[0]?.unit).toBeUndefined();
  });
});

describe("LineTable — sub-items are the previous generation", () => {
  it("offers the editor on a line that already has them", () => {
    table([{ d: "Painting", q: 1, r: 100, sub: [{ d: "Walls", q: 2400, amt: 9840 }] }]);
    expect(screen.getByText("↳ Sub-items (1)")).toBeTruthy();
  });

  it("does not offer them on a line that does not", () => {
    table([{ d: "Painting", q: 1, r: 100 }]);
    expect(screen.queryByText(/Sub-items/)).toBeNull();
    expect(screen.queryByText(/Add sub-items/)).toBeNull();
  });
});

describe("LineTable — the rest of the row still works", () => {
  it("adds a line from the footer", () => {
    table([fence]);
    fireEvent.click(screen.getByText("+ Add line"));
    expect(lastLines()).toHaveLength(2);
  });

  it("keeps the scope editor reachable", () => {
    table([fence]);
    fireEvent.click(screen.getByText("¶ Add scope"));
    const detail = screen.getByLabelText(/scope/i);
    expect(within(document.body).getByText("¶ Add scope")).toBeTruthy();
    expect(detail).toBeTruthy();
  });
});

describe("LineTable — sections", () => {
  const grouped = () =>
    table(
      [
        { d: "Trip charge", q: 1, r: 95 },
        { d: "Repaint walls", q: 1, r: 1800, sectionIndex: 0 },
        { d: "Reseal deck", q: 1, r: 900, sectionIndex: 1 },
      ],
      false,
      ["Interior", "Exterior"],
    );

  it("renders ungrouped lines first, then each heading with the lines under it", () => {
    grouped();
    const rows = [...document.querySelectorAll("tbody tr")];
    const described = rows
      .map((r) => (r.querySelector("input") as HTMLInputElement | null)?.value)
      .filter((v) => v !== undefined);
    expect(described).toEqual(["Trip charge", "Interior", "Repaint walls", "Exterior", "Reseal deck"]);
  });

  it("shows what the lines under a heading add up to", () => {
    grouped();
    const totals = [...document.querySelectorAll(".sectionrow-total")].map((n) => n.textContent);
    expect(totals).toEqual(["$1,800", "$900"]);
  });

  it("leaves an assembly's components out of a heading's total", () => {
    // The parent's amount already contains them — the same rule the quote's own total follows.
    table(
      [
        { d: "Cedar fence", q: 100, r: 11.58, sectionIndex: 0 },
        { d: "Line posts", q: 14, r: 24.3, parentIndex: 0, sectionIndex: 0 },
      ],
      false,
      ["Exterior"],
    );
    expect(document.querySelector(".sectionrow-total")?.textContent).toBe("$1,158");
  });

  it("adds a line already inside the heading it was added from", () => {
    grouped();
    fireEvent.click(screen.getByText("+ Add line to Exterior"));
    expect(lastLines()[3]).toMatchObject({ sectionIndex: 1 });
  });

  it("renames a heading", () => {
    grouped();
    fireEvent.change(input("Section name, section 1"), { target: { value: "Inside" } });
    expect(lastSections().sections).toEqual(["Inside", "Exterior"]);
  });

  it("keeps the work when a heading is removed, and re-points the headings after it", () => {
    // Deleting a heading is not a request to delete the work under it, and there is no undo.
    grouped();
    fireEvent.click(screen.getByLabelText("Remove section 1"));
    const next = lastSections();
    expect(next.sections).toEqual(["Exterior"]);
    expect(next.lines.map((l: ComposerLine) => l.d)).toEqual([
      "Trip charge",
      "Repaint walls",
      "Reseal deck",
    ]);
    expect(next.lines[1]?.sectionIndex).toBeUndefined();
    expect(next.lines[2]?.sectionIndex).toBe(0);
  });

  it("offers no headings at all when the caller does not handle them", () => {
    cleanup();
    render(<LineTable lines={[fence]} showCost={false} onLines={onLines} />);
    expect(screen.queryByText("+ Section")).toBeNull();
  });
});

describe("LineTable — the costing view", () => {
  it("shows the markup a typed price implies over the cost", () => {
    table([{ d: "Line posts", q: 14, r: 24.3, c: 18 }], true);
    expect(input("Markup percent, line 1").value).toBe("35");
  });

  it("prices the line from its cost when the markup is edited", () => {
    table([{ d: "Line posts", q: 14, r: 0, c: 18 }], true);
    fireEvent.change(input("Markup percent, line 1"), { target: { value: "35" } });
    expect(lastLines()[0]).toMatchObject({ r: 24.3, markupBps: 3500 });
  });

  it("reprices a cost-plus line when the cost moves", () => {
    table([{ d: "Line posts", q: 14, r: 24.3, c: 18, markupBps: 3500 }], true);
    fireEvent.change(input("Your cost, line 1"), { target: { value: "20" } });
    expect(lastLines()[0]?.r).toBe(27);
  });

  it("leaves a hand-typed price alone when the cost moves", () => {
    table([{ d: "Line posts", q: 14, r: 24.3, c: 18 }], true);
    fireEvent.change(input("Your cost, line 1"), { target: { value: "20" } });
    expect(lastLines()[0]?.r).toBe(24.3);
  });

  it("drops the markup when a price is typed over it", () => {
    table([{ d: "Line posts", q: 14, r: 24.3, c: 18, markupBps: 3500 }], true);
    fireEvent.change(input("Price, line 1"), { target: { value: "30" } });
    expect(lastLines()[0]?.markupBps).toBeUndefined();
    expect(lastLines()[0]?.r).toBe(30);
  });

  it("shows no markup field where the price is not the line's to set", () => {
    table([fence, posts], true);
    expect(screen.queryByLabelText("Markup percent, line 1")).toBeNull();
    expect(screen.getByLabelText("Markup percent, line 2")).toBeTruthy();
  });

  it("hides the whole costing view when the cost is not shown", () => {
    table([{ d: "Line posts", q: 14, r: 24.3, c: 18 }], false);
    expect(screen.queryByLabelText("Markup percent, line 1")).toBeNull();
  });
});

describe("LineTable — the pricebook control", () => {
  const onSaveAssembly = vi.fn();
  const savedParts = [
    { d: "Line posts", unit: "ea", qtyExpr: "qty/8+1", roundUp: true, cost: 18, rate: 24.3, markupBps: 3500 },
  ];

  const withBook = (lines: ComposerLine[], saved?: Map<string, typeof savedParts>) => {
    cleanup();
    onSaveAssembly.mockClear();
    return render(
      <LineTable
        lines={lines}
        showCost={false}
        onLines={onLines}
        savedAssemblies={saved}
        onSaveAssembly={onSaveAssembly}
      />,
    );
  };

  const bookedPosts: ComposerLine = {
    d: "Line posts",
    q: 14,
    r: 24.3,
    c: 18,
    unit: "ea",
    qtyExpr: "qty/8+1",
    roundUp: true,
    markupBps: 3500,
    parentIndex: 0,
  };

  it("offers to save an assembly that is not in the book", () => {
    withBook([fence, posts]);
    expect(screen.getByText("+ Save to pricebook")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Save to pricebook"));
    expect(onSaveAssembly).toHaveBeenCalledWith(0, null);
  });

  it("says so, and offers nothing to press, when the assembly matches the book", () => {
    // An assembly that matches has nothing to do — a button there would be a control that
    // decides nothing.
    withBook(
      [{ ...fence, pricebookItemId: "pb-1" }, bookedPosts],
      new Map([["pb-1", savedParts]]),
    );
    expect(screen.getByText("✓ In pricebook")).toBeTruthy();
    expect(screen.queryByText("+ Save to pricebook")).toBeNull();
    expect(screen.queryByText("↑ Update in pricebook")).toBeNull();
  });

  it("offers both update and save-as-new once it has drifted", () => {
    withBook(
      [{ ...fence, pricebookItemId: "pb-1" }, { ...bookedPosts, r: 26 }],
      new Map([["pb-1", savedParts]]),
    );
    fireEvent.click(screen.getByText("↑ Update in pricebook"));
    expect(onSaveAssembly).toHaveBeenCalledWith(0, "pb-1");
    fireEvent.click(screen.getByText("+ Save as new"));
    expect(onSaveAssembly).toHaveBeenLastCalledWith(0, null);
  });

  it("reads as unsaved while the book has not loaded", () => {
    // The honest answer when nothing is known — never "✓ In pricebook" on faith.
    withBook([{ ...fence, pricebookItemId: "pb-1" }, bookedPosts], undefined);
    expect(screen.getByText("+ Save to pricebook")).toBeTruthy();
  });

  it("offers nothing on a plain line — there is no assembly to save", () => {
    withBook([{ d: "Trip charge", q: 1, r: 95 }]);
    expect(screen.queryByText("+ Save to pricebook")).toBeNull();
  });

  it("offers nothing at all when the caller does not handle saving", () => {
    cleanup();
    render(<LineTable lines={[fence, posts]} showCost={false} onLines={onLines} />);
    expect(screen.queryByText("+ Save to pricebook")).toBeNull();
  });
});
