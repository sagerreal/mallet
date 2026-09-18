import { describe, it, expect } from "vitest";
import { colWidths, ALL_COL_DEFS, DEFAULT_COLS } from "./customers-columns";

/**
 * Why the Customers list looked oddly spaced.
 *
 * The table is width:100% with AUTOMATIC layout, so the browser divides the leftover width across
 * the columns in near-equal shares no matter what is in them. On a wide screen with the four
 * default columns, that stranded a stage pill and a phone number in the middle of enormous cells
 * and left a dead gutter on the right.
 *
 * Weights fix it by directing that surplus at the columns whose content can actually use it. The
 * part worth testing is the NORMALISATION: the picker allows any subset, so fixed percentages
 * would under-fill the table with few columns on and overflow it with many.
 */

const sum = (widths: string[]) => widths.reduce((t, w) => t + parseFloat(w), 0);

describe("colWidths", () => {
  it("fills the table exactly with the default four columns", () => {
    expect(sum(colWidths([...DEFAULT_COLS]))).toBeCloseTo(100, 2);
  });

  it("still fills it exactly with every column turned on", () => {
    expect(sum(colWidths(Object.keys(ALL_COL_DEFS)))).toBeCloseTo(100, 2);
  });

  it("fills it with a single column — the degenerate case the picker allows", () => {
    expect(colWidths(["name"])).toEqual(["100.0000%"]);
  });

  it("gives the name more room than the stage pill — the whole point of weighting", () => {
    const [name, stage] = colWidths(["name", "stage"]);
    expect(parseFloat(name!)).toBeGreaterThan(parseFloat(stage!));
  });

  it("keeps proportions when unrelated columns are toggled off", () => {
    const [nameOf3, stageOf3] = colWidths(["name", "stage", "phone"]);
    const ratio3 = parseFloat(nameOf3!) / parseFloat(stageOf3!);
    const [nameOf2, stageOf2] = colWidths(["name", "stage"]);
    expect(parseFloat(nameOf2!) / parseFloat(stageOf2!)).toBeCloseTo(ratio3, 4);
  });

  // The Restore column on the Archived view is not in ALL_COL_DEFS, and an unknown key must not
  // divide by zero or blank the widths.
  it("falls back to a middling weight for an unknown column", () => {
    const widths = colWidths(["name", "not-a-column"]);
    expect(sum(widths)).toBeCloseTo(100, 2);
    expect(parseFloat(widths[1]!)).toBeGreaterThan(0);
  });

  it("returns nothing for no columns rather than throwing", () => {
    expect(colWidths([])).toEqual([]);
  });
});

describe("column defs", () => {
  it("gives every pickable column a weight — a missing one would silently collapse", () => {
    for (const [key, def] of Object.entries(ALL_COL_DEFS)) {
      expect(def.w, `${key} has no weight`).toBeGreaterThan(0);
    }
  });
});

/**
 * WITH NO PICKER, DEFAULT_COLS IS THE WHOLE UI. customers-view renders it verbatim, so a
 * definition missing from this list ships nothing — which is exactly what happened to the old
 * `source` column. These two tests are what makes "add a Tags column" mean anything.
 */
describe("the Tags column is actually reachable", () => {
  it("is in DEFAULT_COLS", () => {
    expect(DEFAULT_COLS).toContain("tags");
  });

  it("has a definition, so it renders a header and a width", () => {
    expect(ALL_COL_DEFS.tags).toBeDefined();
    expect(ALL_COL_DEFS.tags?.l).toBe("Tags");
  });

  it("the retired source column is gone entirely — not left unreachable", () => {
    expect(ALL_COL_DEFS.source).toBeUndefined();
    expect(DEFAULT_COLS).not.toContain("source");
  });

  it("every default column still has a definition", () => {
    for (const col of DEFAULT_COLS) expect(ALL_COL_DEFS[col]).toBeDefined();
  });

  it("the five default columns still fill the table exactly", () => {
    expect(sum(colWidths([...DEFAULT_COLS]))).toBeCloseTo(100, 2);
  });
});
