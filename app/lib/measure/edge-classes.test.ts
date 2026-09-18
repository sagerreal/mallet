import { describe, it, expect } from "vitest";
import {
  EDGE_CLASSES,
  cycleEdgeClass,
  cycleInteriorLineClass,
  defaultEdgeClasses,
  edgeReadout,
  edgeTotalFor,
  edgeTotalsFt,
  formatEdgeFt,
  isClassified,
  roofComplexity,
  sphericalDistanceMeters,
  type EdgeClass,
  type InteriorLineShape,
} from "./edge-classes";

// A rectangle on the equator, where spherical arc lengths are hand-checkable:
// 0.001° of longitude at lat 0 = 6378137 m × 0.001·π/180 = 111.3195 m = 365.22 ft;
// 0.0005° of latitude = 55.6597 m = 182.61 ft. Vertices wind v0 → v3, edge i =
// vertex i → i+1 (edge 3 wraps back to v0).
const RECT = [
  { lat: 0, lng: 0 }, //        edge 0: v0→v1, 365.22 ft (long side)
  { lat: 0, lng: 0.001 }, //    edge 1: v1→v2, 182.61 ft (short side)
  { lat: 0.0005, lng: 0.001 }, // edge 2: v2→v3, 365.22 ft
  { lat: 0.0005, lng: 0 }, //   edge 3: v3→v0, 182.61 ft
];
const LONG_FT = 365.22;
const SHORT_FT = 182.61;

describe("sphericalDistanceMeters", () => {
  it("matches the textbook arc length for a pure-longitude hop on the equator", () => {
    const d = sphericalDistanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    expect(d).toBeCloseTo(111.3195, 3);
  });

  it("matches for a pure-latitude hop", () => {
    const d = sphericalDistanceMeters({ lat: 0, lng: 0 }, { lat: 0.0005, lng: 0 });
    expect(d).toBeCloseTo(55.6597, 3);
  });

  it("is zero for identical points", () => {
    expect(sphericalDistanceMeters({ lat: 35.77, lng: -78.64 }, { lat: 35.77, lng: -78.64 })).toBe(0);
  });
});

describe("edgeTotalsFt", () => {
  it("sums each perimeter edge into its class (known coordinates)", () => {
    const classes: EdgeClass[] = ["eave", "hip", "ridge", "valley"];
    const totals = edgeTotalsFt(RECT, classes, undefined);
    expect(totals.eaveFt).toBeCloseTo(LONG_FT, 1);
    expect(totals.hipFt).toBeCloseTo(SHORT_FT, 1);
    expect(totals.ridgeFt).toBeCloseTo(LONG_FT, 1);
    expect(totals.valleyFt).toBeCloseTo(SHORT_FT, 1);
    expect(totals.rakeFt).toBe(0);
  });

  it("adds interior lines to their class alongside perimeter edges", () => {
    const classes: EdgeClass[] = ["eave", "rake", "eave", "rake"];
    const interior: InteriorLineShape[] = [
      { a: { lat: 0.00025, lng: 0 }, b: { lat: 0.00025, lng: 0.001 }, cls: "ridge" },
    ];
    const totals = edgeTotalsFt(RECT, classes, interior);
    expect(totals.eaveFt).toBeCloseTo(2 * LONG_FT, 1);
    expect(totals.rakeFt).toBeCloseTo(2 * SHORT_FT, 1);
    expect(totals.ridgeFt).toBeCloseTo(LONG_FT, 1);
  });

  it("treats missing classes as unclassified — legacy captures yield zeros", () => {
    const totals = edgeTotalsFt(RECT, undefined, undefined);
    expect(totals).toEqual({ eaveFt: 0, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0 });
  });

  it("a short classes array only counts the edges it covers (defensive)", () => {
    const totals = edgeTotalsFt(RECT, ["eave"] as EdgeClass[], undefined);
    expect(totals.eaveFt).toBeCloseTo(LONG_FT, 1);
    expect(totals.rakeFt + totals.ridgeFt + totals.hipFt + totals.valleyFt).toBe(0);
  });
});

describe("cycling", () => {
  it("cycles EAVE → RAKE → RIDGE → HIP → VALLEY → EAVE", () => {
    expect(cycleEdgeClass("eave")).toBe("rake");
    expect(cycleEdgeClass("rake")).toBe("ridge");
    expect(cycleEdgeClass("ridge")).toBe("hip");
    expect(cycleEdgeClass("hip")).toBe("valley");
    expect(cycleEdgeClass("valley")).toBe("eave");
  });

  it("a full cycle returns to the start for every class", () => {
    for (const cls of EDGE_CLASSES) {
      let c = cls;
      for (let i = 0; i < EDGE_CLASSES.length; i += 1) c = cycleEdgeClass(c);
      expect(c).toBe(cls);
    }
  });

  it("interior lines cycle RIDGE → HIP → VALLEY → RIDGE", () => {
    expect(cycleInteriorLineClass("ridge")).toBe("hip");
    expect(cycleInteriorLineClass("hip")).toBe("valley");
    expect(cycleInteriorLineClass("valley")).toBe("ridge");
  });
});

describe("defaultEdgeClasses", () => {
  it("defaults every edge to EAVE", () => {
    expect(defaultEdgeClasses(4)).toEqual(["eave", "eave", "eave", "eave"]);
    expect(defaultEdgeClasses(0)).toEqual([]);
  });
});

describe("roofComplexity", () => {
  it("counts hips and valleys across perimeter and interior; any at all is cut-up", () => {
    const perimeter: EdgeClass[] = ["eave", "hip", "eave", "hip"];
    const interior: InteriorLineShape[] = [
      { a: { lat: 0, lng: 0 }, b: { lat: 0, lng: 0.001 }, cls: "valley" },
    ];
    expect(roofComplexity(perimeter, interior)).toEqual({ hips: 2, valleys: 1, cutUp: true });
  });

  it("a plain gable (eaves + rakes + ridge) is not cut-up", () => {
    expect(roofComplexity(["eave", "rake", "eave", "rake"], [])).toEqual({
      hips: 0,
      valleys: 0,
      cutUp: false,
    });
  });
});

describe("isClassified", () => {
  it("false for legacy captures (no classes, no lines)", () => {
    expect(isClassified(undefined, undefined)).toBe(false);
    expect(isClassified(undefined, [])).toBe(false);
  });

  it("true once edge classes or interior lines exist", () => {
    expect(isClassified(["eave"], undefined)).toBe(true);
    expect(
      isClassified(undefined, [{ a: { lat: 0, lng: 0 }, b: { lat: 1, lng: 1 }, cls: "ridge" }]),
    ).toBe(true);
  });
});

describe("readout", () => {
  const totals = { eaveFt: 160.4, rakeFt: 99.6, ridgeFt: 40, hipFt: 0, valleyFt: 0 };

  it("lists non-zero classes in cycle order with whole feet", () => {
    expect(edgeReadout(totals)).toBe("Eaves 160 ft · Rakes 100 ft · Ridge 40 ft");
  });

  it("is empty when nothing is classified", () => {
    expect(edgeReadout({ eaveFt: 0, rakeFt: 0, ridgeFt: 0, hipFt: 0, valleyFt: 0 })).toBe("");
  });

  it("formatEdgeFt rounds and thousand-separates", () => {
    expect(formatEdgeFt(1203.5)).toBe("1,204 ft");
  });

  it("edgeTotalFor picks the matching field", () => {
    expect(edgeTotalFor(totals, "rake")).toBe(99.6);
    expect(edgeTotalFor(totals, "valley")).toBe(0);
  });
});
