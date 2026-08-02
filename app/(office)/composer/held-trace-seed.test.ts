/**
 * app/(office)/composer/held-trace-seed.test.ts
 *
 * The client/server math-parity guarantee. A trace HELD on the quote seeds
 * lines with pure client math (held-trace-seed.ts + lib/measure/held-trace.ts);
 * the same trace persisted as a site capture seeds through the server
 * (CreateSiteCaptureUseCase's pitchCorrectedArea → BuildFromMeasurementsUseCase).
 * These tests run the REAL server use-case against in-memory readers and
 * assert the two paths produce byte-identical lines — description, quantity,
 * rate, cost — for flat and pitched surfaces, plus the selection rules
 * (lowest-position active service, order-independent tie-break) and the gap
 * behavior when no service prices a kind.
 */

import { describe, it, expect } from "vitest";
import { BuildFromMeasurementsUseCase } from "@/modules/quoting/app/build-from-measurements";
import { pitchCorrectedArea } from "@/modules/measurements/domain/site-capture";
import type { RateService } from "@/modules/quoting/domain/rate-services-reader";
import type { SiteQuantitiesForJob } from "@/modules/measurements/domain/site-quantities-reader";
import type { Service } from "@/lib/store/types";
import { createHeldTrace, heldTraceSummary, type HeldTrace } from "@/lib/measure/held-trace";
import { round2 } from "@/lib/measure/aerial-geometry";
import { heldTraceSourceName, seedFromHeldTrace, serviceForKind } from "./held-trace-seed";

// ---- fixtures ----------------------------------------------------------------

const POLYGON = {
  vertices: [
    { lat: 40.1, lng: -75.1 },
    { lat: 40.1, lng: -75.2 },
    { lat: 40.2, lng: -75.2 },
  ],
  view: { centerLat: 40.15, centerLng: -75.15, zoom: 20 },
};

/** Store-shaped service (DOLLARS) and its server twin (CENTS) from one spec. */
function servicePair(spec: {
  id: string;
  name: string;
  unitPriceCents: number;
  costCents: number;
  measuredBy: "site_sqft" | "site_lnft" | "hour" | "walls_sqft";
  position: number;
  active?: boolean;
}): { store: Service; server: RateService } {
  return {
    store: {
      id: spec.id,
      name: spec.name,
      unitPrice: spec.unitPriceCents / 100,
      cost: spec.costCents / 100,
      active: spec.active ?? true,
      position: spec.position,
      measuredBy: spec.measuredBy,
    } as Service,
    server: {
      id: spec.id,
      name: spec.name,
      unitPriceCents: spec.unitPriceCents,
      costCents: spec.costCents,
      measuredBy: spec.measuredBy,
      position: spec.position,
    } as RateService,
  };
}

/** Runs the REAL server use-case over the site capture the held trace would become. */
async function serverSeed(trace: HeldTrace, services: readonly RateService[]) {
  // What CreateSiteCaptureUseCase derives from the siteCreate payload the
  // composer would send (the held trace's rounded footprint + pitch).
  const persisted: SiteQuantitiesForJob = {
    name: trace.name,
    surface: trace.surface,
    pitchRise: trace.pitchRise,
    areaSqft: pitchCorrectedArea(trace.footprintSqft, trace.pitchRise ?? 0),
    perimeterLnft: trace.perimeterLnft,
    edges: trace.edges,
    complexity: trace.complexity,
  };
  const useCase = new BuildFromMeasurementsUseCase(
    { findLeadId: async () => "lead-1" as never },
    { readForJob: async () => [] },
    { readForJob: async () => [persisted] },
    { listMeasuredByActive: async () => [...services] },
  );
  const result = await useCase.exec({ jobId: "job-1" as never });
  if (!result.ok) throw new Error("server seed failed");
  return result.value.seedLines.map((l) => ({
    description: l.description,
    quantity: l.quantity,
    rateCents: l.rateCents,
    costCents: l.costCents,
  }));
}

// ---- parity ------------------------------------------------------------------

describe("held-trace seeding — client/server parity", () => {
  it("a FLAT trace seeds identical lines through both paths (area + perimeter)", async () => {
    const sqft = servicePair({
      id: "svc-seal",
      name: "Seal coating",
      unitPriceCents: 45,
      costCents: 12,
      measuredBy: "site_sqft",
      position: 0,
    });
    const lnft = servicePair({
      id: "svc-edge",
      name: "Edge banding",
      unitPriceCents: 250,
      costCents: 80,
      measuredBy: "site_lnft",
      position: 0,
    });
    const trace = createHeldTrace({
      id: "t1",
      name: "Driveway",
      surface: "flat",
      polygon: POLYGON,
      footprintSqft: 640.128, // raw traced float — rounds to the server's 2dp storage
      perimeterLnft: 104.019,
    });

    const client = seedFromHeldTrace(trace, [sqft.store, lnft.store]).lines;
    const server = await serverSeed(trace, [sqft.server, lnft.server]);

    expect(client).toEqual(server);
    expect(client).toEqual([
      { description: "Driveway — Seal coating", quantity: 640.13, rateCents: 45, costCents: 12 },
      { description: "Driveway — Edge banding", quantity: 104.02, rateCents: 250, costCents: 80 },
    ]);
  });

  it("a PITCHED trace corrects the area with the server's exact formula and names the pitch", async () => {
    const sqft = servicePair({
      id: "svc-shingle",
      name: "Shingle install",
      unitPriceCents: 725,
      costCents: 310,
      measuredBy: "site_sqft",
      position: 0,
    });
    const trace = createHeldTrace({
      id: "t2",
      name: "Main roof",
      surface: "pitched",
      pitchRise: 6,
      polygon: POLYGON,
      footprintSqft: 1240.4567,
      perimeterLnft: 142.907,
    });

    // The held working area IS the server formula's output on the rounded footprint.
    expect(trace.areaSqft).toBe(pitchCorrectedArea(round2(1240.4567), 6));

    const client = seedFromHeldTrace(trace, [sqft.store]).lines;
    const server = await serverSeed(trace, [sqft.server]);
    expect(client).toEqual(server);
    expect(client[0]?.description).toBe("Main roof at 6/12 — Shingle install");
    expect(client[0]?.quantity).toBe(trace.areaSqft);
  });

  it("dollars→cents recovery is exact for real pricebook amounts", () => {
    // The store keeps dollars (cents / 100); Math.round(dollars * 100) must
    // recover the original cents even for float-hostile values like 19.99.
    for (const cents of [1, 45, 199, 1999, 72500, 123456789]) {
      const { store } = servicePair({
        id: "svc",
        name: "S",
        unitPriceCents: cents,
        costCents: cents,
        measuredBy: "site_sqft",
        position: 0,
      });
      const trace = createHeldTrace({
        id: "t",
        name: "Pad",
        surface: "flat",
        polygon: POLYGON,
        footprintSqft: 100,
        perimeterLnft: 40,
      });
      const line = seedFromHeldTrace(trace, [store]).lines[0];
      expect(line?.rateCents).toBe(cents);
      expect(line?.costCents).toBe(cents);
    }
  });
});

// ---- selection rules (mirror build-from-measurements) --------------------------

describe("serviceForKind — the server's selection rules", () => {
  const mk = (id: string, name: string, position: number, active = true): Service =>
    ({
      id,
      name,
      unitPrice: 1,
      cost: 0,
      active,
      position,
      measuredBy: "site_sqft",
    }) as Service;

  it("picks the lowest position; ties break by name then id, independent of input order", () => {
    const a = mk("id-b", "Asphalt", 0);
    const b = mk("id-a", "Asphalt", 0);
    // Same position, same name → lowest id wins, whichever order they arrive in.
    expect(serviceForKind([a, b], "site_sqft")?.id).toBe("id-a");
    expect(serviceForKind([b, a], "site_sqft")?.id).toBe("id-a");

    const named = mk("id-z", "Aardvark seal", 0);
    expect(serviceForKind([a, named], "site_sqft")?.id).toBe("id-z");

    const positioned = mk("id-y", "Zz", 1);
    expect(serviceForKind([positioned, a], "site_sqft")?.id).toBe("id-b");
  });

  it("skips inactive services and other kinds", () => {
    const inactive = mk("id-1", "A", 0, false);
    const wrongKind = { ...mk("id-2", "B", 0), measuredBy: "walls_sqft" } as Service;
    expect(serviceForKind([inactive, wrongKind], "site_sqft")).toBeNull();
  });
});

describe("seedFromHeldTrace — gaps and zero guards", () => {
  const trace = createHeldTrace({
    id: "t",
    name: "Patio",
    surface: "flat",
    polygon: POLYGON,
    footprintSqft: 320,
    perimeterLnft: 72,
  });

  it("a kind with no priced service becomes a named gap, never a silent skip", () => {
    const result = seedFromHeldTrace(trace, []);
    expect(result.lines).toEqual([]);
    expect(result.gaps).toEqual(["Site area", "Site perimeter"]);
  });

  it("source naming: flat is the plain name, pitched carries its pitch", () => {
    expect(heldTraceSourceName({ name: "Patio", surface: "flat", pitchRise: null })).toBe("Patio");
    expect(heldTraceSourceName({ name: "Roof", surface: "pitched", pitchRise: 8 })).toBe(
      "Roof at 8/12",
    );
  });
});

describe("heldTraceSummary", () => {
  it("flat — '640 sqft · 104 lnft'", () => {
    const trace = createHeldTrace({
      id: "t",
      name: "Driveway",
      surface: "flat",
      polygon: POLYGON,
      footprintSqft: 640.2,
      perimeterLnft: 104.4,
    });
    expect(heldTraceSummary(trace)).toBe("640 sqft · 104 lnft");
  });

  it("pitched — footprint + corrected roof area at the pitch", () => {
    const trace = createHeldTrace({
      id: "t",
      name: "Roof",
      surface: "pitched",
      pitchRise: 6,
      polygon: POLYGON,
      footprintSqft: 1240,
      perimeterLnft: 143,
    });
    expect(heldTraceSummary(trace)).toBe(
      "Footprint 1,240 sqft · Roof area 1,386 sqft at 6/12 · 143 lnft",
    );
  });
});
