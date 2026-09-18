/**
 * lib/measure/held-trace.edges.test.ts
 *
 * The client/server parity guarantee for CLASSED linears. A trace held on the
 * quote derives its per-class feet with pure client math (createHeldTrace →
 * lib/measure/edge-classes); the same polygon persisted as a site capture gets
 * its edges derived server-side (toSiteCaptureDTO, same shared module). These
 * tests run the REAL domain factory + DTO mapper and assert byte-identical
 * totals and complexity, plus the classed row summary and the legacy/flat
 * null behavior.
 */

import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, isOk } from "@mallet/shared/types";
import { SiteCapture, pitchCorrectedArea, type SitePolygon } from "@/modules/measurements/domain/site-capture";
import { toSiteCaptureDTO } from "@/modules/measurements/api/measurement-dto";
import { createHeldTrace, heldTraceSummary } from "./held-trace";
import type { SitePolygonShape } from "@/lib/store/types";

const NOW = new Date("2026-08-01T12:00:00Z");

// Equator rectangle with hand-checkable arc lengths (see edge-classes.test.ts):
// long sides 365.22 ft, short sides 182.61 ft.
const POLYGON: SitePolygonShape = {
  vertices: [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.001 },
    { lat: 0.0005, lng: 0.001 },
    { lat: 0.0005, lng: 0 },
  ],
  view: { centerLat: 0.00025, centerLng: 0.0005, zoom: 20 },
  edgeClasses: ["eave", "rake", "eave", "rake"],
  interiorLines: [
    { a: { lat: 0.00025, lng: 0 }, b: { lat: 0.00025, lng: 0.001 }, cls: "ridge" },
  ],
};

const FOOTPRINT = 66695.4; // plan sqft of the rectangle (approx — the exact value is irrelevant here)
const PERIMETER = 1095.67;

function heldTrace(polygon: SitePolygonShape) {
  return createHeldTrace({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Main roof",
    surface: "pitched",
    pitchRise: 6,
    polygon,
    footprintSqft: FOOTPRINT,
    perimeterLnft: PERIMETER,
  });
}

function serverDTO(polygon: SitePolygonShape) {
  const created = SiteCapture.create({
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    jobId: asJobId("33333333-3333-3333-3333-333333333333"),
    name: "Main roof",
    source: "aerial_trace_v1",
    surface: "pitched",
    pitchRise: 6,
    polygon: polygon as SitePolygon,
    footprintSqft: FOOTPRINT,
    areaSqft: pitchCorrectedArea(FOOTPRINT, 6),
    perimeterLnft: PERIMETER,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  if (!isOk(created)) throw new Error(`fixture capture invalid: ${created.error.message}`);
  return toSiteCaptureDTO(created.value);
}

describe("held-trace edge parity (client math === server DTO derive)", () => {
  it("derives identical per-class totals and complexity on both paths", () => {
    const held = heldTrace(POLYGON);
    const dto = serverDTO(POLYGON);

    expect(held.edges).not.toBeNull();
    expect(dto.edges).not.toBeNull();
    expect(held.edges).toEqual(dto.edges);
    expect(held.complexity).toEqual(dto.complexity);

    // Sanity against the hand-checked coordinates, not just self-consistency.
    expect(held.edges?.eaveFt).toBeCloseTo(2 * 365.22, 1);
    expect(held.edges?.rakeFt).toBeCloseTo(2 * 182.61, 1);
    expect(held.edges?.ridgeFt).toBeCloseTo(365.22, 1);
    expect(held.complexity).toEqual({ hips: 0, valleys: 0, cutUp: false });
  });

  it("hips/valleys flip the complexity to cut-up identically on both paths", () => {
    const cutUp: SitePolygonShape = {
      ...POLYGON,
      edgeClasses: ["eave", "hip", "eave", "valley"],
    };
    const held = heldTrace(cutUp);
    const dto = serverDTO(cutUp);
    expect(held.complexity).toEqual({ hips: 1, valleys: 1, cutUp: true });
    expect(dto.complexity).toEqual(held.complexity);
  });

  it("an UNCLASSIFIED polygon yields null edges/complexity on both paths", () => {
    const legacy: SitePolygonShape = {
      vertices: POLYGON.vertices,
      view: POLYGON.view,
    };
    const held = heldTrace(legacy);
    const dto = serverDTO(legacy);
    expect(held.edges).toBeNull();
    expect(held.complexity).toBeNull();
    expect(dto.edges).toBeNull();
    expect(dto.complexity).toBeNull();
  });

  it("the DTO polygon carries the classification for the tracer to re-draw", () => {
    const dto = serverDTO(POLYGON);
    expect(dto.polygon?.edgeClasses).toEqual(POLYGON.edgeClasses);
    expect(dto.polygon?.interiorLines).toEqual(POLYGON.interiorLines);
  });
});

describe("heldTraceSummary with classes", () => {
  it("a classified pitched trace reads out classed linears instead of the perimeter", () => {
    const summary = heldTraceSummary(heldTrace(POLYGON));
    expect(summary).toContain("Eaves 730 ft");
    expect(summary).toContain("Rakes 365 ft");
    expect(summary).toContain("Ridge 365 ft");
    expect(summary).not.toContain("lnft");
  });

  it("an unclassified trace keeps the perimeter figure", () => {
    const summary = heldTraceSummary(
      heldTrace({ vertices: POLYGON.vertices, view: POLYGON.view }),
    );
    expect(summary).toContain("1,096 lnft");
  });
});
