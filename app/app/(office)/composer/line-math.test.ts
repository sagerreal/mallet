/**
 * The assembly math the composer runs on every keystroke. What is worth testing here is not
 * arithmetic — it is the two things that would move money into the wrong place: the roll-up's
 * divide-by-driver (without which every existing `quantity × rate` surface reads a wrong
 * number), and the index bookkeeping when a line is added or removed.
 */
import { describe, it, expect } from "vitest";
import {
  resolveQuantity,
  isPlainQuantity,
  componentIndexes,
  isAssembly,
  isComponent,
  rollUp,
  withRollUps,
  removeLineAt,
  addComponent,
  reindexForPayload,
  isPricedFromCost,
  impliedMarkupBps,
  withMarkup,
  repriceFromCost,
  withTypedRate,
  linesFromSavedAssembly,
  assemblySyncState,
  type SavedComponent,
} from "./line-math";
import type { ComposerLine } from "./composer-state";

const line = (over: Partial<ComposerLine> = {}): ComposerLine => ({
  d: "Line",
  q: 1,
  r: 0,
  ...over,
});

describe("resolveQuantity", () => {
  const fence = line({ d: "Cedar fence", q: 100, unit: "LF" });

  it("counts a component off its parent's quantity", () => {
    const posts = line({ qtyExpr: "qty/8+1", roundUp: true, q: 0 });
    expect(resolveQuantity(posts, fence).value).toBe(14);
  });

  it("recounts when the driver changes — the whole point of an assembly", () => {
    const posts = line({ qtyExpr: "qty/8+1", roundUp: true });
    expect(resolveQuantity(posts, { ...fence, q: 150 }).value).toBe(20);
  });

  it("accepts the parent's unit as a name for the driver", () => {
    expect(resolveQuantity(line({ qtyExpr: "LF/2" }), fence).value).toBe(50);
  });

  it("leaves an ordinary line's typed quantity alone", () => {
    expect(resolveQuantity(line({ q: 7 })).value).toBe(7);
  });

  it("reports unparseable math as invalid and prices it at zero", () => {
    const broken = resolveQuantity(line({ qtyExpr: "qty/" }), fence);
    expect(broken.valid).toBe(false);
    expect(broken.value).toBe(0);
  });

  it("resolves a component with no parent against a driver of zero", () => {
    // Mid-edit a component can briefly have no parent; it must not throw or read NaN.
    expect(resolveQuantity(line({ qtyExpr: "qty/8+1" })).value).toBe(1);
  });
});

describe("isPlainQuantity", () => {
  it("separates a number from math", () => {
    expect(isPlainQuantity("100")).toBe(true);
    expect(isPlainQuantity("1,200.5")).toBe(true);
    expect(isPlainQuantity("qty/8+1")).toBe(false);
    expect(isPlainQuantity(undefined)).toBe(false);
  });
});

describe("componentIndexes / isAssembly / isComponent", () => {
  const lines = [
    line({ d: "Fence", q: 100 }),
    line({ d: "Posts", parentIndex: 0 }),
    line({ d: "Rails", parentIndex: 0 }),
    line({ d: "Trip charge" }),
  ];

  it("finds a parent's components", () => {
    expect(componentIndexes(lines, 0)).toEqual([1, 2]);
    expect(componentIndexes(lines, 3)).toEqual([]);
  });

  it("knows an assembly from a plain line, and a component from a parent", () => {
    expect(isAssembly(lines, 0)).toBe(true);
    expect(isAssembly(lines, 3)).toBe(false);
    expect(isComponent(lines[1]!)).toBe(true);
    expect(isComponent(lines[0]!)).toBe(false);
  });
});

describe("rollUp", () => {
  const fence = line({ d: "Cedar fence", q: 100, unit: "LF" });

  it("divides the components' total by the driver to get a rate", () => {
    // 14 posts at $24.30 = $340.20 across a 100 LF run → $3.40 a foot, to the cent.
    const rolled = rollUp(fence, [line({ qtyExpr: "qty/8+1", roundUp: true, r: 24.3 })]);
    expect(rolled.componentsTotal).toBe(340.2);
    expect(rolled.rate).toBe(3.4);
  });

  it("quotes the rate, not the components' sum, when the two cannot be equal", () => {
    // $3.402 a foot is not a price anyone can quote. The rate is what is sold; the components
    // are how it was found, and the costing view shows both so the difference is never hidden.
    const rolled = rollUp(fence, [line({ qtyExpr: "qty/8+1", roundUp: true, r: 24.3 })]);
    expect(fence.q * rolled.rate).toBe(340);
    expect(rolled.componentsTotal).toBe(340.2);
  });

  it("sums every component", () => {
    const rolled = rollUp(fence, [
      line({ q: 14, r: 24.3, c: 18 }),
      line({ q: 100, r: 3.5, c: 2 }),
    ]);
    expect(rolled.componentsTotal).toBe(340.2 + 350);
    expect(rolled.componentsCost).toBe(252 + 200);
  });

  it("leaves cost undefined when no component carries one — an unknown cost is not zero", () => {
    expect(rollUp(fence, [line({ q: 1, r: 100 })]).cost).toBeUndefined();
  });

  it("prices nothing rather than dividing by a driver of zero", () => {
    const rolled = rollUp({ ...fence, q: 0 }, [line({ q: 1, r: 100 })]);
    expect(rolled.rate).toBe(0);
    expect(rolled.cost).toBeUndefined();
  });
});

describe("withRollUps", () => {
  it("rewrites a parent's rate and leaves ordinary lines untouched", () => {
    const lines = [
      line({ d: "Fence", q: 100 }),
      line({ d: "Posts", qtyExpr: "qty/8+1", roundUp: true, r: 24.3, c: 18, parentIndex: 0 }),
      line({ d: "Trip charge", q: 1, r: 95 }),
    ];
    const next = withRollUps(lines);
    expect(next[0]?.r).toBeCloseTo(3.4, 2);
    expect(next[0]?.c).toBeCloseTo(2.52, 2);
    // Identity is preserved for lines that did not move — cheap re-renders, and a real signal.
    expect(next[1]).toBe(lines[1]);
    expect(next[2]).toBe(lines[2]);
  });

  it("returns the same parent object when the roll-up did not change it", () => {
    const lines = [line({ d: "Fence", q: 100, r: 1 }), line({ q: 100, r: 1, parentIndex: 0 })];
    expect(withRollUps(lines)[0]).toBe(lines[0]);
  });
});

describe("removeLineAt", () => {
  const lines = [
    line({ d: "Fence" }),
    line({ d: "Posts", parentIndex: 0 }),
    line({ d: "Gate" }),
    line({ d: "Hinges", parentIndex: 2 }),
  ];

  it("takes an assembly's components with it", () => {
    expect(removeLineAt(lines, 0).map((l) => l.d)).toEqual(["Gate", "Hinges"]);
  });

  it("keeps every surviving component pointed at the same parent", () => {
    // The defect this guards: a plain splice leaves Hinges pointing at index 2, which after the
    // removal is a different line — the component's money moves to another assembly.
    const next = removeLineAt(lines, 0);
    expect(next[1]?.parentIndex).toBe(0);
    expect(next[next[1]!.parentIndex!]?.d).toBe("Gate");
  });

  it("removes a lone component without touching its siblings' parents", () => {
    const next = removeLineAt(lines, 1);
    expect(next.map((l) => l.d)).toEqual(["Fence", "Gate", "Hinges"]);
    expect(next[2]?.parentIndex).toBe(1);
  });
});

describe("addComponent", () => {
  it("inserts beneath the parent's existing components", () => {
    const lines = [
      line({ d: "Fence" }),
      line({ d: "Posts", parentIndex: 0 }),
      line({ d: "Gate" }),
    ];
    const next = addComponent(lines, 0, line({ d: "Rails" }));
    expect(next.map((l) => l.d)).toEqual(["Fence", "Posts", "Rails", "Gate"]);
    expect(next[2]?.parentIndex).toBe(0);
  });

  it("inserts directly beneath a parent that has none yet", () => {
    const next = addComponent([line({ d: "Fence" }), line({ d: "Gate" })], 0, line({ d: "Posts" }));
    expect(next.map((l) => l.d)).toEqual(["Fence", "Posts", "Gate"]);
  });

  it("re-points the components of later assemblies past the insertion", () => {
    const lines = [line({ d: "Fence" }), line({ d: "Gate" }), line({ d: "Hinges", parentIndex: 1 })];
    const next = addComponent(lines, 0, line({ d: "Posts" }));
    expect(next.map((l) => l.d)).toEqual(["Fence", "Posts", "Gate", "Hinges"]);
    expect(next[3]?.parentIndex).toBe(2);
    expect(next[next[3]!.parentIndex!]?.d).toBe("Gate");
  });
});

describe("reindexForPayload", () => {
  const real = (l: ComposerLine) => (l.d ?? "").trim() !== "";

  it("re-points a parent reference past the rows that were dropped", () => {
    // The corruption this guards: filtering blank scaffolding rows shifts every position, and
    // parentIndex is a position — the component's money lands on a different line.
    const lines = [
      line({ d: "" }),
      line({ d: "Cedar fence", q: 100 }),
      line({ d: "Line posts", parentIndex: 1 }),
    ];
    const out = reindexForPayload(lines, real);
    expect(out.map((l) => l.d)).toEqual(["Cedar fence", "Line posts"]);
    expect(out[1]?.parentIndex).toBe(0);
    expect(out[out[1]!.parentIndex!]?.d).toBe("Cedar fence");
  });

  it("drops a component whose parent did not survive", () => {
    // A part with no assembly around it is not a line to charge for.
    const out = reindexForPayload([line({ d: "" }), line({ d: "Line posts", parentIndex: 0 })], real);
    expect(out).toEqual([]);
  });

  it("leaves an array with no components untouched", () => {
    const lines = [line({ d: "A" }), line({ d: "B" })];
    expect(reindexForPayload(lines, real)).toEqual(lines);
  });

  it("keeps every component with its own parent across several assemblies", () => {
    const lines = [
      line({ d: "Fence" }),
      line({ d: "Posts", parentIndex: 0 }),
      line({ d: "" }),
      line({ d: "Gate" }),
      line({ d: "Hinges", parentIndex: 3 }),
    ];
    const out = reindexForPayload(lines, real);
    expect(out.map((l) => l.d)).toEqual(["Fence", "Posts", "Gate", "Hinges"]);
    expect(out[out[1]!.parentIndex!]?.d).toBe("Fence");
    expect(out[out[3]!.parentIndex!]?.d).toBe("Gate");
  });
});

describe("pricing from cost", () => {
  it("carrying a markup IS the statement that the price came from the cost", () => {
    expect(isPricedFromCost(line({ markupBps: 3500 }))).toBe(true);
    expect(isPricedFromCost(line({ r: 100 }))).toBe(false);
  });

  it("prices from the cost when a markup is set", () => {
    expect(withMarkup(line({ c: 18 }), 3500).r).toBe(24.3);
  });

  it("reports the markup a typed price implies over the cost", () => {
    expect(impliedMarkupBps(line({ c: 18, r: 24.3 }))).toBe(3500);
  });

  it("reports no markup against a cost of zero rather than dividing by it", () => {
    expect(impliedMarkupBps(line({ c: 0, r: 100 }))).toBe(0);
  });

  it("reprices when the cost moves, but only a line that is priced from cost", () => {
    expect(repriceFromCost({ ...line({ markupBps: 3500 }), c: 20 }).r).toBe(27);
    // A hand-typed price is the estimator's number and a cost change must not move it.
    expect(repriceFromCost({ ...line({ r: 100 }), c: 20 }).r).toBe(100);
  });

  it("drops the markup when a price is typed — the number is the estimator's now", () => {
    const typed = withTypedRate(line({ c: 18, markupBps: 3500, r: 24.3 }), 30);
    expect(typed.r).toBe(30);
    expect("markupBps" in typed).toBe(false);
  });

  it("refuses a negative markup rather than pricing below cost by accident", () => {
    expect(withMarkup(line({ c: 18 }), -500).markupBps).toBe(0);
  });
});

describe("linesFromSavedAssembly", () => {
  const saved = {
    id: "pb-1",
    name: "Cedar privacy fence",
    unit: "LF",
    unitPrice: 11.58,
    quantity: 100,
    cost: 8.4,
    taxable: true,
    components: [
      { d: "Line posts", unit: "ea", qtyExpr: "qty/8+1", roundUp: true, cost: 18, rate: 24.3, markupBps: 3500 },
      { d: "Pickets", unit: "ea", qtyExpr: "qty*2", cost: 2.1, rate: 4.15 },
    ] satisfies SavedComponent[],
  };

  it("drops the parent in with its parts beneath it", () => {
    const next = linesFromSavedAssembly([{ d: "Trip charge", q: 1, r: 95 }], saved);
    expect(next.map((l) => l.d)).toEqual(["Trip charge", "Cedar privacy fence", "Line posts", "Pickets"]);
    expect(next[2]?.parentIndex).toBe(1);
    expect(next[3]?.parentIndex).toBe(1);
  });

  it("copies the parts exactly — the stored fields ARE the line's fields", () => {
    const posts = linesFromSavedAssembly([], saved)[1]!;
    expect(posts).toMatchObject({ unit: "ea", qtyExpr: "qty/8+1", roundUp: true, c: 18, r: 24.3, markupBps: 3500 });
  });

  it("records which entry it came from, so it can be updated later", () => {
    expect(linesFromSavedAssembly([], saved)[0]?.pricebookItemId).toBe("pb-1");
  });

  it("lands at the run it was saved at, so its price still means what the picker said", () => {
    // The defect this guards: at a driver of 1, "qty/8+1" gives $29.38 a foot for an entry the
    // picker just offered at $3.51 a foot. The same entry, contradicting itself on screen.
    const next = linesFromSavedAssembly([], saved);
    expect(next[0]?.q).toBe(100);
    expect(next[1]?.q).toBe(14); // ceil(100/8 + 1)
    expect(next[2]?.q).toBe(200); // 100*2
  });

  it("falls back to 1 for an entry saved before the run was kept", () => {
    // An older row, not a wrong one — it still applies, and the office types the run.
    expect(linesFromSavedAssembly([], { ...saved, quantity: null })[0]?.q).toBe(1);
  });

  it("carries the exception, not the default, for tax", () => {
    expect(linesFromSavedAssembly([], saved)[0]?.notax).toBeUndefined();
    expect(linesFromSavedAssembly([], { ...saved, taxable: false })[0]?.notax).toBe(true);
  });
});

describe("assemblySyncState", () => {
  const savedParts: SavedComponent[] = [
    { d: "Line posts", unit: "ea", qtyExpr: "qty/8+1", roundUp: true, cost: 18, rate: 24.3, markupBps: 3500 },
  ];
  const liveParts = [
    line({ d: "Line posts", unit: "ea", qtyExpr: "qty/8+1", roundUp: true, c: 18, r: 24.3, markupBps: 3500 }),
  ];
  const parent = line({ d: "Cedar privacy fence", q: 100, pricebookItemId: "pb-1" });

  it("is unsaved when the line names no entry", () => {
    expect(assemblySyncState(line({ d: "Fence" }), liveParts, savedParts)).toBe("unsaved");
  });

  it("is unsaved when the entry it names is not in the book any more", () => {
    expect(assemblySyncState(parent, liveParts, undefined)).toBe("unsaved");
  });

  it("is synced when the parts match", () => {
    expect(assemblySyncState(parent, liveParts, savedParts)).toBe("synced");
  });

  it("is modified once a part changes", () => {
    const edited = [{ ...liveParts[0]!, r: 26 }];
    expect(assemblySyncState(parent, edited, savedParts)).toBe("modified");
  });

  it("is modified when a part is added or removed", () => {
    expect(assemblySyncState(parent, [...liveParts, line({ d: "Rails" })], savedParts)).toBe("modified");
    expect(assemblySyncState(parent, [], savedParts)).toBe("modified");
  });

  it("stays synced when only the PARENT's own rate moved", () => {
    // The roll-up rounds to the cent on the way into a quote. Calling that drift would train
    // the office to ignore the word.
    expect(assemblySyncState({ ...parent, r: 3.4 }, liveParts, savedParts)).toBe("synced");
  });
});
