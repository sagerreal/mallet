import { describe, it, expect } from "vitest";
import {
  canUndoLine,
  cycleEdgeAt,
  cycleInteriorLineAt,
  initialEdgeEdit,
  placeLinePoint,
  toggleAddLine,
  undoLine,
} from "./edge-edit";

const P1 = { lat: 35.771, lng: -78.638 };
const P2 = { lat: 35.7712, lng: -78.6378 };

describe("initialEdgeEdit", () => {
  it("starts every edge as an EAVE with no lines and nothing armed", () => {
    const s = initialEdgeEdit(4);
    expect(s.edgeClasses).toEqual(["eave", "eave", "eave", "eave"]);
    expect(s.interiorLines).toEqual([]);
    expect(s.addingLine).toBe(false);
    expect(s.draftPoint).toBeNull();
  });
});

describe("cycleEdgeAt", () => {
  it("cycles only the tapped edge and never mutates", () => {
    const s0 = initialEdgeEdit(3);
    const s1 = cycleEdgeAt(s0, 1);
    expect(s1.edgeClasses).toEqual(["eave", "rake", "eave"]);
    expect(s0.edgeClasses).toEqual(["eave", "eave", "eave"]); // untouched
    expect(cycleEdgeAt(s1, 1).edgeClasses[1]).toBe("ridge");
  });

  it("ignores an out-of-range index", () => {
    const s = initialEdgeEdit(3);
    expect(cycleEdgeAt(s, 9)).toBe(s);
  });
});

describe("interior lines", () => {
  it("arms, places two points, and lands a RIDGE line, disarmed", () => {
    let s = toggleAddLine(initialEdgeEdit(3));
    expect(s.addingLine).toBe(true);

    s = placeLinePoint(s, P1);
    expect(s.draftPoint).toEqual(P1);
    expect(s.interiorLines).toHaveLength(0);

    s = placeLinePoint(s, P2);
    expect(s.interiorLines).toEqual([{ a: P1, b: P2, cls: "ridge" }]);
    expect(s.addingLine).toBe(false);
    expect(s.draftPoint).toBeNull();
  });

  it("map taps while disarmed place nothing", () => {
    const s = initialEdgeEdit(3);
    expect(placeLinePoint(s, P1)).toBe(s);
  });

  it("cancelling (toggle while armed) drops a half-placed point", () => {
    let s = placeLinePoint(toggleAddLine(initialEdgeEdit(3)), P1);
    s = toggleAddLine(s);
    expect(s.addingLine).toBe(false);
    expect(s.draftPoint).toBeNull();
    expect(s.interiorLines).toHaveLength(0);
  });

  it("tapping a line cycles RIDGE → HIP → VALLEY", () => {
    let s = placeLinePoint(placeLinePoint(toggleAddLine(initialEdgeEdit(3)), P1), P2);
    s = cycleInteriorLineAt(s, 0);
    expect(s.interiorLines[0]?.cls).toBe("hip");
    s = cycleInteriorLineAt(s, 0);
    expect(s.interiorLines[0]?.cls).toBe("valley");
    expect(cycleInteriorLineAt(s, 5)).toBe(s); // out of range: no-op
  });

  it("undo removes the half-placed point first, then the last line", () => {
    let s = placeLinePoint(placeLinePoint(toggleAddLine(initialEdgeEdit(3)), P1), P2);
    s = placeLinePoint(toggleAddLine(s), P1); // second line half-placed
    expect(canUndoLine(s)).toBe(true);

    s = undoLine(s);
    expect(s.draftPoint).toBeNull();
    expect(s.interiorLines).toHaveLength(1); // the finished line survives

    s = undoLine(s);
    expect(s.interiorLines).toHaveLength(0);
    expect(canUndoLine(s)).toBe(false);
    expect(undoLine(s)).toBe(s); // nothing left: no-op
  });
});
