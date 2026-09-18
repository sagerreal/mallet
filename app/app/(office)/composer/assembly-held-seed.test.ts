/**
 * app/(office)/composer/assembly-held-seed.test.ts
 *
 * The client/server ASSEMBLY parity guarantee — the sibling of
 * held-trace-seed.test.ts for recipe pricing. A trace HELD on the quote seeds
 * through seedHeldTraceWithAssembly (pure client math); the same geometry
 * persisted as a site capture seeds through the REAL SeedFromCaptureUseCase
 * (in-memory reader + repo). Both paths call the ONE engine
 * (computeAssemblySeed), and these tests assert the outputs are byte-identical
 * — every line field, the total, the minimum notice, the skipped list — for
 * flat and pitched surfaces, catalog defaults and org overrides.
 */

import { describe, it, expect } from "vitest";
import { asJobId, asOrgId } from "@mallet/shared/types";
import { FixedClock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { SiteQuantitiesForJob } from "@/modules/measurements/domain/site-quantities-reader";
import { SeedFromCaptureUseCase } from "@/modules/assemblies/app/seed-from-capture";
import { SaveDialUseCase } from "@/modules/assemblies/app/save-dial";
import { FakeAssemblyRepository } from "@/modules/assemblies/app/fake-assembly-repository";
import { ListAssembliesUseCase, catalogItemId } from "@/modules/assemblies/app/list-assemblies";
import { createHeldTrace, type HeldTrace } from "@/lib/measure/held-trace";
import type { AssemblyView } from "@/lib/store/assemblies-mapper";
import {
  assembliesForSurface,
  seedHeldTraceWithAssembly,
  minimumNoticeText,
} from "./assembly-held-seed";

const POLYGON = {
  vertices: [
    { lat: 40.1, lng: -75.1 },
    { lat: 40.1, lng: -75.2 },
    { lat: 40.2, lng: -75.2 },
  ],
  view: { centerLat: 40.15, centerLng: -75.15, zoom: 20 },
};

const orgId = asOrgId("11111111-1111-1111-1111-111111111111");
const jobId = asJobId("22222222-2222-2222-2222-222222222222");

/** The org's effective book, exactly as the store hydrates it (list → views). */
async function storeViews(repo: FakeAssemblyRepository): Promise<AssemblyView[]> {
  const items = await new ListAssembliesUseCase(repo).exec();
  return items.map((item) => ({
    ...item,
    dials: item.dials.map((d) => ({ ...d })),
  })) as unknown as AssemblyView[];
}

/** The persisted twin of a held trace, as the site reader would serve it.
 * edges/complexity ride over verbatim — legitimate, because the held trace and
 * the reader derive them with the SAME lib/measure/edge-classes functions from
 * the same polygon (that derivation parity is pinned in
 * held-trace.edges.test.ts against the real server mapper). */
function persistedTwin(trace: HeldTrace): SiteQuantitiesForJob {
  return {
    name: trace.name,
    surface: trace.surface,
    pitchRise: trace.pitchRise,
    areaSqft: trace.areaSqft,
    perimeterLnft: trace.perimeterLnft > 0 ? trace.perimeterLnft : null,
    edges: trace.edges,
    complexity: trace.complexity,
  };
}

const readerFor = (sites: SiteQuantitiesForJob[]) => ({ readForJob: async () => sites });

async function bothPaths(
  trace: HeldTrace,
  view: AssemblyView,
  repo: FakeAssemblyRepository,
): Promise<{ client: unknown; server: unknown }> {
  const client = seedHeldTraceWithAssembly(trace, view);
  if (!client.ok) throw new Error(`client seed failed: ${client.error.message}`);
  const useCase = new SeedFromCaptureUseCase(readerFor([persistedTwin(trace)]), repo);
  const server = await useCase.exec({ jobId, sourceName: trace.name, assemblyId: view.id });
  if (!server.ok) throw new Error(`server seed failed: ${server.error.message}`);
  // Byte-identical: serialize both results the same way and compare strings.
  return { client: JSON.parse(JSON.stringify(client.value)), server: JSON.parse(JSON.stringify(server.value)) };
}

const flatTrace = (name: string, sqft: number): HeldTrace =>
  createHeldTrace({
    id: "t1",
    name,
    surface: "flat",
    polygon: POLYGON,
    footprintSqft: sqft,
    perimeterLnft: 120,
  });

describe("held vs persisted assembly seeding — byte-identical", () => {
  it("driveway replacement (cost-plus) on a flat 800 sqft trace", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const driveway = views.find((v) => v.catalogKey === "driveway_replacement_3in")!;
    const { client, server } = await bothPaths(flatTrace("Driveway", 800), driveway, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });

  it("sealcoat (unit-rate + minimum) on a flat 800 sqft trace", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const sealcoat = views.find((v) => v.catalogKey === "sealcoat_two_coats")!;
    const { client, server } = await bothPaths(flatTrace("Back lot", 800), sealcoat, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
    const parsed = client as { minimum: { minimumCents: number } | null };
    expect(parsed.minimum).not.toBeNull();
    expect(minimumNoticeText(parsed.minimum!)).toBe(
      "Below your $350 job minimum — priced at the minimum.",
    );
  });

  it("a PITCHED trace carries its pitch into both descriptions identically", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const sealcoat = views.find((v) => v.catalogKey === "sealcoat_two_coats")!;
    // createHeldTrace derives the working area from the footprint via the
    // server's exact pitch formula — the twin below reads it back verbatim.
    const trace: HeldTrace = createHeldTrace({
      id: "t2",
      name: "Main roof",
      surface: "pitched",
      pitchRise: 6,
      polygon: POLYGON,
      footprintSqft: 2000,
      perimeterLnft: 180,
    });
    const { client, server } = await bothPaths(trace, sealcoat, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
    const first = (client as { lines: { description: string }[] }).lines[0]!;
    expect(first.description).toBe("Main roof at 6/12 — Sealcoat, two coats");
  });

  it("an ORG OVERRIDE prices both paths with the overridden constant", async () => {
    const repo = new FakeAssemblyRepository();
    const clock = new FixedClock(new Date("2026-08-01T12:00:00Z"));
    const ids: IdGenerator = { newId: () => "33333333-3333-3333-3333-333333333333" };
    const saved = await new SaveDialUseCase(repo, clock, ids).exec(
      { assemblyId: catalogItemId("sealcoat_two_coats"), dialKey: "rate_mid", rawValue: 30 },
      orgId,
    );
    if (!saved.ok) throw new Error("setup");
    const views = await storeViews(repo);
    const sealcoat = views.find((v) => v.catalogKey === "sealcoat_two_coats")!;
    expect(sealcoat.isOverride).toBe(true);
    const { client, server } = await bothPaths(flatTrace("Driveway", 3000), sealcoat, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
    const first = (client as { lines: { rateCents: number }[] }).lines[0]!;
    expect(first.rateCents).toBe(30);
  });

  it("perimeter-basis crack filling parity, incl. the skipped/minimum fields", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const crack = views.find((v) => v.catalogKey === "crack_filling")!;
    const { client, server } = await bothPaths(flatTrace("Lot edge", 900), crack, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
  });

  it("a CLASSIFIED pitched trace prices the shingle reroof byte-identically on both paths", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const reroof = views.find((v) => v.catalogKey === "asphalt_shingle_reroof")!;
    // A rectangle with a ridge line: eaves top+bottom, rakes the sides, one
    // interior ridge — createHeldTrace derives edges/complexity through the
    // same shared math the server reader runs.
    const trace = createHeldTrace({
      id: "t-roof",
      name: "Main roof",
      surface: "pitched",
      pitchRise: 6,
      polygon: {
        vertices: [
          { lat: 40.1, lng: -75.1 },
          { lat: 40.1, lng: -75.1006 },
          { lat: 40.1004, lng: -75.1006 },
          { lat: 40.1004, lng: -75.1 },
        ],
        view: { centerLat: 40.1002, centerLng: -75.1003, zoom: 20 },
        edgeClasses: ["eave", "rake", "eave", "rake"],
        interiorLines: [
          {
            a: { lat: 40.1002, lng: -75.1 },
            b: { lat: 40.1002, lng: -75.1006 },
            cls: "ridge",
          },
        ],
      },
      footprintSqft: 2400,
      perimeterLnft: 260,
    });
    expect(trace.edges).not.toBeNull();
    const { client, server } = await bothPaths(trace, reroof, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
    const parsed = client as {
      lines: { description: string }[];
      derivedWaste: { percent: number; reason: string } | null;
    };
    // No hips/valleys on this gable → the simple tier derived, and reported.
    expect(parsed.derivedWaste).toEqual({ percent: 10, reason: "simple roof" });
    expect(parsed.lines[0]!.description).toContain("Field shingles");
  });

  it("an UNCLASSIFIED pitched trace seeds the reroof with identical named gaps on both paths", async () => {
    const repo = new FakeAssemblyRepository();
    const views = await storeViews(repo);
    const reroof = views.find((v) => v.catalogKey === "asphalt_shingle_reroof")!;
    const trace = createHeldTrace({
      id: "t-plain",
      name: "Garage roof",
      surface: "pitched",
      pitchRise: 4,
      polygon: POLYGON, // no edgeClasses/interiorLines — unclassified
      footprintSqft: 900,
      perimeterLnft: 130,
    });
    expect(trace.edges).toBeNull();
    const { client, server } = await bothPaths(trace, reroof, repo);
    expect(JSON.stringify(client)).toBe(JSON.stringify(server));
    const parsed = client as { skipped: { label: string; need: string }[] };
    expect(parsed.skipped.map((s) => s.need)).toEqual(["edges", "edges", "edges", "edges"]);
  });
});

describe("assembliesForSurface — the picker's matching rule", () => {
  const flat = (areaSqft: number, perimeterLnft: number | null) => ({
    areaSqft,
    perimeterLnft,
    surface: "flat" as const,
    edges: null,
  });

  it("area assemblies need a working area; perimeter assemblies need a perimeter", async () => {
    const views = await storeViews(new FakeAssemblyRepository());
    const both = assembliesForSurface(views, flat(800, 120));
    expect(both.map((v) => v.catalogKey)).toEqual([
      "driveway_replacement_3in",
      "asphalt_overlay_15in",
      "sealcoat_two_coats",
      "crack_filling",
      "paver_driveway",
    ]);
    const areaOnly = assembliesForSurface(views, flat(800, null));
    expect(areaOnly.some((v) => v.catalogKey === "crack_filling")).toBe(false);
    expect(assembliesForSurface(views, flat(0, null))).toEqual([]);
  });

  it("roofing recipes offer on PITCHED surfaces only — classified or not; never flat", async () => {
    const views = await storeViews(new FakeAssemblyRepository());
    // Flat: no roofing, ever.
    expect(assembliesForSurface(views, flat(800, 120)).some((v) => v.catalogKey === "asphalt_shingle_reroof")).toBe(false);
    // Pitched WITHOUT classified edges: offered — its edge components will
    // seed as named gaps, not silently.
    const unclassified = assembliesForSurface(views, {
      areaSqft: 2400,
      perimeterLnft: 260,
      surface: "pitched",
      edges: null,
    });
    expect(unclassified.map((v) => v.catalogKey)).toContain("asphalt_shingle_reroof");
    expect(unclassified.map((v) => v.catalogKey)).toContain("roof_tuneup");
    // Pitched WITH classified edges: offered.
    const classified = assembliesForSurface(views, {
      areaSqft: 2400,
      perimeterLnft: 260,
      surface: "pitched",
      edges: { eaveFt: 160, rakeFt: 100, ridgeFt: 40, hipFt: 0, valleyFt: 0 },
    });
    expect(classified.map((v) => v.catalogKey)).toContain("asphalt_shingle_reroof");
  });
});
