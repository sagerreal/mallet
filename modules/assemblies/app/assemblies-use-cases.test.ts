import { describe, it, expect } from "vitest";
import { FixedClock, asOrgId, asJobId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { FakeAssemblyRepository } from "./fake-assembly-repository";
import { ListAssembliesUseCase, catalogItemId } from "./list-assemblies";
import { SaveDialUseCase } from "./save-dial";
import { ArchiveAssemblyUseCase } from "./archive-assembly";
import { CreateAssemblyUseCase } from "./create-assembly";
import { SeedFromCaptureUseCase } from "./seed-from-capture";
import { DEFAULT_ASSEMBLIES, catalogAssemblyByKey } from "../domain/assembly-defaults";

const orgId = asOrgId("11111111-1111-1111-1111-111111111111");
const clock = () => new FixedClock(new Date("2026-08-01T12:00:00Z"));
const ids = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-00000000000${++n}` };
};

const harness = () => {
  const repo = new FakeAssemblyRepository();
  const c = clock();
  const gen = ids();
  return {
    repo,
    list: new ListAssembliesUseCase(repo),
    saveDial: new SaveDialUseCase(repo, c, gen),
    archive: new ArchiveAssemblyUseCase(repo, c, gen),
    create: new CreateAssemblyUseCase(repo, c, gen),
  };
};

describe("list-assemblies — read-time catalog merge", () => {
  it("an untouched org lists the full shipped catalog with zero rows", async () => {
    const { list } = harness();
    const items = await list.exec();
    expect(items.map((i) => i.catalogKey)).toEqual(DEFAULT_ASSEMBLIES.map((d) => d.catalogKey));
    expect(items.every((i) => !i.isOverride && i.id.startsWith("catalog:"))).toBe(true);
    // dial views carry current === default before any edit
    for (const item of items) {
      for (const dial of item.dials) expect(dial.currentRaw).toBe(dial.defaultRaw);
    }
  });

  it("a dial edit materializes ONE override row that replaces its default in the list", async () => {
    const { list, saveDial, repo } = harness();
    const result = await saveDial.exec(
      { assemblyId: catalogItemId("driveway_replacement_3in"), dialKey: "hma_price", rawValue: 13500 },
      orgId,
    );
    expect(result.ok).toBe(true);

    const items = await list.exec();
    expect(items).toHaveLength(DEFAULT_ASSEMBLIES.length);
    const driveway = items.find((i) => i.catalogKey === "driveway_replacement_3in")!;
    expect(driveway.isOverride).toBe(true);
    expect(driveway.id).not.toContain("catalog:");
    const dial = driveway.dials.find((d) => d.key === "hma_price")!;
    expect(dial.currentRaw).toBe(13500);
    expect(dial.defaultRaw).toBe(12000);
    // exactly one row persisted
    expect((await repo.listAll())).toHaveLength(1);
  });

  it("a second dial edit patches the SAME row (no duplicate override)", async () => {
    const { list, saveDial, repo } = harness();
    await saveDial.exec(
      { assemblyId: catalogItemId("driveway_replacement_3in"), dialKey: "hma_price", rawValue: 13500 },
      orgId,
    );
    const rowId = (await repo.listAll())[0]!.assembly.props.id;
    // Second edit addresses the ROW id, as the refreshed client would.
    const second = await saveDial.exec({ assemblyId: rowId, dialKey: "margin", rawValue: 3000 }, orgId);
    expect(second.ok).toBe(true);
    expect(await repo.listAll()).toHaveLength(1);
    const driveway = (await list.exec()).find((i) => i.catalogKey === "driveway_replacement_3in")!;
    expect(driveway.marginBps).toBe(3000);
    expect(driveway.dials.find((d) => d.key === "hma_price")!.currentRaw).toBe(13500);
  });

  it("reset = writing the shipped value back through the dial", async () => {
    const { list, saveDial } = harness();
    await saveDial.exec(
      { assemblyId: catalogItemId("sealcoat_two_coats"), dialKey: "job_min", rawValue: 50_000 },
      orgId,
    );
    const item = (await list.exec()).find((i) => i.catalogKey === "sealcoat_two_coats")!;
    const dial = item.dials.find((d) => d.key === "job_min")!;
    const reset = await saveDial.exec(
      { assemblyId: item.id, dialKey: "job_min", rawValue: dial.defaultRaw },
      orgId,
    );
    expect(reset.ok).toBe(true);
    const after = (await list.exec()).find((i) => i.catalogKey === "sealcoat_two_coats")!;
    expect(after.jobMinimumCents).toBe(35_000);
  });

  it("saveDial refuses an unknown dial and a bogus value", async () => {
    const { saveDial } = harness();
    const unknown = await saveDial.exec(
      { assemblyId: catalogItemId("crack_filling"), dialKey: "nope", rawValue: 1 },
      orgId,
    );
    expect(unknown.ok).toBe(false);
    const negative = await saveDial.exec(
      { assemblyId: catalogItemId("crack_filling"), dialKey: "rate", rawValue: -5 },
      orgId,
    );
    expect(negative.ok).toBe(false);
  });
});

describe("archive-assembly — removing from the book", () => {
  it("removing an untouched default tombstones it out of the list", async () => {
    const { list, archive } = harness();
    const result = await archive.exec({ assemblyId: catalogItemId("paver_driveway") }, orgId);
    expect(result.ok).toBe(true);
    const items = await list.exec();
    expect(items.some((i) => i.catalogKey === "paver_driveway")).toBe(false);
    expect(items).toHaveLength(DEFAULT_ASSEMBLIES.length - 1);
  });

  it("a later dial edit resurrects the removed default", async () => {
    const { list, archive, saveDial } = harness();
    await archive.exec({ assemblyId: catalogItemId("paver_driveway") }, orgId);
    const back = await saveDial.exec(
      { assemblyId: catalogItemId("paver_driveway"), dialKey: "paver_cost", rawValue: 400 },
      orgId,
    );
    expect(back.ok).toBe(true);
    const item = (await list.exec()).find((i) => i.catalogKey === "paver_driveway");
    expect(item?.isOverride).toBe(true);
  });

  it("archiving a custom row soft-deletes it; unknown ids are notFound", async () => {
    const { list, archive, create } = harness();
    const entry = catalogAssemblyByKey("crack_filling")!;
    const created = await create.exec(
      {
        name: "Trench patch",
        measurementBasis: "perimeter",
        pricingMode: "unit_rate",
        marginBps: 0,
        jobMinimumCents: 0,
        config: entry.config,
      },
      orgId,
    );
    if (!created.ok) throw new Error("setup");
    expect((await list.exec()).some((i) => i.name === "Trench patch")).toBe(true);

    const removed = await archive.exec({ assemblyId: created.value.props.id }, orgId);
    expect(removed.ok).toBe(true);
    expect((await list.exec()).some((i) => i.name === "Trench patch")).toBe(false);

    const missing = await archive.exec(
      { assemblyId: "99999999-9999-9999-9999-999999999999" },
      orgId,
    );
    expect(missing.ok).toBe(false);
  });
});

describe("create-assembly (custom)", () => {
  it("creates a custom scope with a validated config; bad blobs are refused", async () => {
    const { create, list } = harness();
    const entry = catalogAssemblyByKey("sealcoat_two_coats")!;
    const good = await create.exec(
      {
        name: "Lot striping",
        measurementBasis: "area",
        pricingMode: "unit_rate",
        marginBps: 0,
        jobMinimumCents: 10_000,
        config: entry.config,
      },
      orgId,
    );
    expect(good.ok).toBe(true);
    const items = await list.exec();
    const custom = items.find((i) => i.name === "Lot striping")!;
    expect(custom.catalogKey).toBeNull();
    expect(custom.dials).toEqual([]); // customs have no shipped constants

    const bad = await create.exec(
      {
        name: "Broken",
        measurementBasis: "area",
        pricingMode: "cost_plus",
        marginBps: 1000,
        jobMinimumCents: 0,
        config: { version: 1, components: [], tiers: null },
      },
      orgId,
    );
    expect(bad.ok).toBe(false);
  });
});

describe("seed-from-capture — the server seeding path", () => {
  const sites = (surfaces: { name: string; areaSqft: number; perimeterLnft: number | null; pitchRise?: number }[]) => ({
    readForJob: async () =>
      surfaces.map((s) => ({
        name: s.name,
        surface: (s.pitchRise !== undefined ? "pitched" : "flat") as "pitched" | "flat",
        pitchRise: s.pitchRise ?? null,
        areaSqft: s.areaSqft,
        perimeterLnft: s.perimeterLnft,
        edges: null,
        complexity: null,
      })),
  });

  it("prices a named capture through a catalog assembly", async () => {
    const { repo } = harness();
    const useCase = new SeedFromCaptureUseCase(
      sites([{ name: "Driveway", areaSqft: 3000, perimeterLnft: 260 }]),
      repo,
    );
    const result = await useCase.exec({
      jobId: asJobId("22222222-2222-2222-2222-222222222222"),
      sourceName: "Driveway",
      assemblyId: catalogItemId("sealcoat_two_coats"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]!.description).toBe("Driveway — Sealcoat, two coats");
      expect(result.value.totalCents).toBe(66_000);
    }
  });

  it("uses the org's OVERRIDE constants when one exists for the catalog key", async () => {
    const { repo, saveDial } = harness();
    await saveDial.exec(
      { assemblyId: catalogItemId("sealcoat_two_coats"), dialKey: "rate_mid", rawValue: 30 },
      orgId,
    );
    const useCase = new SeedFromCaptureUseCase(
      sites([{ name: "Driveway", areaSqft: 3000, perimeterLnft: null }]),
      repo,
    );
    const result = await useCase.exec({
      jobId: asJobId("22222222-2222-2222-2222-222222222222"),
      sourceName: "Driveway",
      assemblyId: catalogItemId("sealcoat_two_coats"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lines[0]!.rateCents).toBe(30);
  });

  it("refuses a removed default, an unknown capture, an unknown assembly", async () => {
    const { repo, archive } = harness();
    await archive.exec({ assemblyId: catalogItemId("crack_filling") }, orgId);
    const useCase = new SeedFromCaptureUseCase(
      sites([{ name: "Lot edge", areaSqft: 0, perimeterLnft: 300 }]),
      repo,
    );
    const jobId = asJobId("22222222-2222-2222-2222-222222222222");
    const removed = await useCase.exec({
      jobId,
      sourceName: "Lot edge",
      assemblyId: catalogItemId("crack_filling"),
    });
    expect(removed.ok).toBe(false);

    const missingCapture = await useCase.exec({
      jobId,
      sourceName: "Back patio",
      assemblyId: catalogItemId("sealcoat_two_coats"),
    });
    expect(missingCapture.ok).toBe(false);

    const missingAssembly = await useCase.exec({
      jobId,
      sourceName: "Lot edge",
      assemblyId: "catalog:not_a_thing",
    });
    expect(missingAssembly.ok).toBe(false);
  });

  it("decorates a pitched capture's source name with its pitch", async () => {
    const { repo } = harness();
    const useCase = new SeedFromCaptureUseCase(
      sites([{ name: "Main roof", areaSqft: 2400, perimeterLnft: 200, pitchRise: 6 }]),
      repo,
    );
    const result = await useCase.exec({
      jobId: asJobId("22222222-2222-2222-2222-222222222222"),
      sourceName: "Main roof",
      assemblyId: catalogItemId("sealcoat_two_coats"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lines[0]!.description).toBe("Main roof at 6/12 — Sealcoat, two coats");
    }
  });
});
