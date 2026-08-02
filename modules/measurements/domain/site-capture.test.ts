import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk, isErr } from "@mallet/shared/types";
import {
  SiteCapture,
  pitchCorrectedArea,
  parseSitePolygon,
  type SiteCaptureProps,
  type SitePolygon,
} from "./site-capture";

const NOW = new Date("2026-07-30T12:00:00Z");

const polygon: SitePolygon = {
  vertices: [
    { lat: 35.771, lng: -78.638 },
    { lat: 35.7712, lng: -78.638 },
    { lat: 35.7712, lng: -78.6378 },
  ],
  view: { centerLat: 35.7711, centerLng: -78.6379, zoom: 20 },
};

const baseProps = (overrides: Partial<SiteCaptureProps> = {}): SiteCaptureProps => ({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  jobId: asJobId("33333333-3333-3333-3333-333333333333"),
  name: "Driveway",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  polygon,
  footprintSqft: 640,
  areaSqft: 640,
  perimeterLnft: 104,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
  ...overrides,
});

// ── pitchCorrectedArea ────────────────────────────────────────────────────────

describe("pitchCorrectedArea", () => {
  it("passes the footprint through unchanged for a 0 rise (flat)", () => {
    expect(pitchCorrectedArea(640, 0)).toBe(640);
  });

  it("corrects a 4/12 pitch by ~1.0541", () => {
    expect(pitchCorrectedArea(1000, 4)).toBeCloseTo(1054.09, 2);
    expect(pitchCorrectedArea(1000, 4) / 1000).toBeCloseTo(1.0541, 3);
  });

  it("corrects a 12/12 pitch by ~1.4142", () => {
    expect(pitchCorrectedArea(1000, 12) / 1000).toBeCloseTo(1.4142, 3);
  });

  it("rounds to 2 decimal places", () => {
    const result = pitchCorrectedArea(123.45, 7);
    expect(result).toBe(Math.round(result * 100) / 100);
  });
});

// ── SiteCapture.create ────────────────────────────────────────────────────────

describe("SiteCapture.create", () => {
  it("creates a valid flat traced capture and trims the name", () => {
    const result = SiteCapture.create(baseProps({ name: "  Driveway  " }));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.name).toBe("Driveway");
  });

  it("rejects an empty name", () => {
    const result = SiteCapture.create(baseProps({ name: "   " }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("name");
  });

  it("rejects an unknown source", () => {
    const result = SiteCapture.create(baseProps({ source: "drone_v9" as never }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("source");
  });

  it("rejects an unknown surface", () => {
    const result = SiteCapture.create(baseProps({ surface: "slanted" as never }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("surface");
  });

  it("rejects a flat surface carrying a pitch", () => {
    const result = SiteCapture.create(baseProps({ surface: "flat", pitchRise: 4 }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("pitchRise");
  });

  it("rejects a pitched surface without a pitch", () => {
    const result = SiteCapture.create(baseProps({ surface: "pitched", pitchRise: null }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("pitchRise");
  });

  it.each([0, 25, 4.5, Number.NaN])("rejects invalid pitch %s", (pitchRise) => {
    const result = SiteCapture.create(baseProps({ surface: "pitched", pitchRise }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("pitchRise");
  });

  it("accepts a pitched surface with a valid pitch", () => {
    const result = SiteCapture.create(baseProps({ surface: "pitched", pitchRise: 4, areaSqft: 674.62 }));
    expect(isOk(result)).toBe(true);
  });

  it.each([0, -1, Number.NaN])("rejects area %s", (areaSqft) => {
    const result = SiteCapture.create(baseProps({ areaSqft }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("areaSqft");
  });

  it("rejects a polygon with fewer than 3 vertices", () => {
    const result = SiteCapture.create(
      baseProps({ polygon: { ...polygon, vertices: polygon.vertices.slice(0, 2) } }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("polygon");
  });

  it("rejects a polygon with a non-finite vertex", () => {
    const result = SiteCapture.create(
      baseProps({
        polygon: { ...polygon, vertices: [...polygon.vertices.slice(0, 2), { lat: Number.NaN, lng: 0 }] },
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("polygon");
  });

  it("rejects a traced polygon without a footprint", () => {
    const result = SiteCapture.create(baseProps({ footprintSqft: null }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("footprintSqft");
  });

  it("rejects an aerial_trace_v1 capture with no polygon", () => {
    const result = SiteCapture.create(baseProps({ polygon: null, footprintSqft: null }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.field).toBe("polygon");
  });

  it("rejects a manual capture carrying a polygon or footprint", () => {
    const withPolygon = SiteCapture.create(baseProps({ source: "manual" }));
    expect(isErr(withPolygon)).toBe(true);

    const withFootprint = SiteCapture.create(
      baseProps({ source: "manual", polygon: null, footprintSqft: 640 }),
    );
    expect(isErr(withFootprint)).toBe(true);
  });

  it("accepts a manual capture with just a name and a typed area", () => {
    const result = SiteCapture.create(
      baseProps({ source: "manual", polygon: null, footprintSqft: null, perimeterLnft: null, areaSqft: 500 }),
    );
    expect(isOk(result)).toBe(true);
  });
});

// ── parseSitePolygon ──────────────────────────────────────────────────────────

describe("parseSitePolygon", () => {
  it("parses a valid wire polygon", () => {
    const result = parseSitePolygon(JSON.parse(JSON.stringify(polygon)));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.vertices).toHaveLength(3);
  });

  it.each([null, "polygon", 42, { vertices: "nope" }, { vertices: [{ lat: 1 }], view: polygon.view }])(
    "rejects malformed value %#",
    (value) => {
      expect(isErr(parseSitePolygon(value))).toBe(true);
    },
  );

  it("rejects a polygon missing its view", () => {
    expect(isErr(parseSitePolygon({ vertices: polygon.vertices }))).toBe(true);
  });
});

// ── edge classification (v2 additive polygon shape) ───────────────────────────

const classedPolygon: SitePolygon = {
  ...polygon,
  edgeClasses: ["eave", "rake", "ridge"],
  interiorLines: [
    { a: { lat: 35.7711, lng: -78.638 }, b: { lat: 35.7711, lng: -78.6378 }, cls: "ridge" },
  ],
};

describe("SiteCapture.create with edge classification", () => {
  it("accepts a polygon carrying edge classes and interior lines", () => {
    const result = SiteCapture.create(baseProps({ polygon: classedPolygon }));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.polygon?.edgeClasses).toEqual(["eave", "rake", "ridge"]);
      expect(result.value.props.polygon?.interiorLines).toHaveLength(1);
    }
  });

  it("rejects edgeClasses whose length differs from the vertex count", () => {
    const result = SiteCapture.create(
      baseProps({ polygon: { ...classedPolygon, edgeClasses: ["eave", "rake"] } }),
    );
    expect(isErr(result)).toBe(true);
  });

  it("rejects an unknown edge class", () => {
    const result = SiteCapture.create(
      baseProps({ polygon: { ...polygon, edgeClasses: ["eave", "gable", "ridge"] as never } }),
    );
    expect(isErr(result)).toBe(true);
  });

  it("rejects an interior line with an EAVE class (interior lines are ridge/hip/valley)", () => {
    const result = SiteCapture.create(
      baseProps({
        polygon: {
          ...polygon,
          interiorLines: [
            { a: { lat: 1, lng: 1 }, b: { lat: 2, lng: 2 }, cls: "eave" as never },
          ],
        },
      }),
    );
    expect(isErr(result)).toBe(true);
  });

  it("rejects an interior line with non-finite endpoints", () => {
    const result = SiteCapture.create(
      baseProps({
        polygon: {
          ...polygon,
          interiorLines: [{ a: { lat: Number.NaN, lng: 1 }, b: { lat: 2, lng: 2 }, cls: "ridge" }],
        },
      }),
    );
    expect(isErr(result)).toBe(true);
  });
});

describe("parseSitePolygon with edge classification", () => {
  it("round-trips a classified polygon through the wire shape", () => {
    const result = parseSitePolygon(JSON.parse(JSON.stringify(classedPolygon)));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.edgeClasses).toEqual(["eave", "rake", "ridge"]);
      expect(result.value.interiorLines).toEqual(classedPolygon.interiorLines);
    }
  });

  it("a LEGACY polygon without classes stays valid and comes back unclassified", () => {
    const result = parseSitePolygon(JSON.parse(JSON.stringify(polygon)));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.edgeClasses).toBeUndefined();
      expect(result.value.interiorLines).toBeUndefined();
    }
  });

  it.each([
    { ...classedPolygon, edgeClasses: "eave" }, // not an array
    { ...classedPolygon, edgeClasses: ["eave", "nope", "ridge"] }, // unknown class
    { ...classedPolygon, edgeClasses: ["eave"] }, // wrong length
    { ...classedPolygon, interiorLines: 42 }, // not an array
    { ...classedPolygon, interiorLines: [{ a: { lat: 1 }, b: { lat: 2, lng: 2 }, cls: "ridge" }] },
    { ...classedPolygon, interiorLines: [{ a: { lat: 1, lng: 1 }, b: { lat: 2, lng: 2 }, cls: "eave" }] },
  ])("rejects a present-but-malformed classification %#", (value) => {
    expect(isErr(parseSitePolygon(JSON.parse(JSON.stringify(value))))).toBe(true);
  });
});
