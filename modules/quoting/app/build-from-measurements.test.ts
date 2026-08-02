import { describe, it, expect } from "vitest";
import { asJobId, asLeadId, asServiceId, isOk, type JobId, type LeadId } from "@mallet/shared/types";
import type {
  RoomQuantitiesForJob,
  RoomQuantitiesReader,
  SiteQuantitiesForJob,
  SiteQuantitiesReader,
} from "@mallet/measurements";
import type { RateService, RateServicesReader } from "../domain/rate-services-reader";
import { BuildFromMeasurementsUseCase, type JobLeadReader } from "./build-from-measurements";

const JOB: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");

class FakeJobLeadReader implements JobLeadReader {
  constructor(private readonly leadId: LeadId | null) {}
  async findLeadId(jobId: JobId): Promise<LeadId | null> {
    return jobId === JOB ? this.leadId : null;
  }
}

class FakeRoomQuantitiesReader implements RoomQuantitiesReader {
  constructor(private readonly rooms: RoomQuantitiesForJob[]) {}
  async readForJob(): Promise<RoomQuantitiesForJob[]> {
    return this.rooms;
  }
}

class FakeSiteQuantitiesReader implements SiteQuantitiesReader {
  constructor(private readonly sites: SiteQuantitiesForJob[]) {}
  async readForJob(): Promise<SiteQuantitiesForJob[]> {
    return this.sites;
  }
}

class FakeRateServicesReader implements RateServicesReader {
  constructor(private readonly services: RateService[]) {}
  async listMeasuredByActive(): Promise<RateService[]> {
    return this.services;
  }
}

const service = (overrides: Partial<RateService>): RateService => ({
  id: asServiceId("33333333-3333-3333-3333-333333333333"),
  name: "Paint walls",
  unitPriceCents: 250,
  costCents: 90,
  measuredBy: "walls_sqft",
  position: 0,
  ...overrides,
});

const flatSite = (overrides: Partial<SiteQuantitiesForJob> = {}): SiteQuantitiesForJob => ({
  name: "Driveway",
  surface: "flat",
  pitchRise: null,
  areaSqft: 640,
  perimeterLnft: 104,
  edges: null,
  complexity: null,
  ...overrides,
});

const build = (
  rooms: RoomQuantitiesForJob[],
  sites: SiteQuantitiesForJob[],
  services: RateService[],
  leadId: LeadId | null = LEAD,
): BuildFromMeasurementsUseCase =>
  new BuildFromMeasurementsUseCase(
    new FakeJobLeadReader(leadId),
    new FakeRoomQuantitiesReader(rooms),
    new FakeSiteQuantitiesReader(sites),
    new FakeRateServicesReader(services),
  );

describe("BuildFromMeasurementsUseCase", () => {
  it("returns notFound when the job does not exist", async () => {
    const useCase = build([], [], [], null);
    const result = await useCase.exec({ jobId: JOB });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("seeds a line per (room, kind) with a resolved quantity and an active priced service", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Living Room",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 240, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "walls_sqft" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.leadId).toBe(LEAD);
    expect(result.value.seedLines).toEqual([
      {
        description: "Living Room — Paint walls",
        quantity: 240,
        rateCents: 250,
        costCents: 90,
        measuredKind: "walls_sqft",
        sourceName: "Living Room",
        serviceId: asServiceId("33333333-3333-3333-3333-333333333333"),
      },
    ]);
    expect(result.value.gaps).toEqual([]);
    expect(result.value.unconfirmedRooms).toEqual([]);
  });

  it("kind with no active measuredBy service produces a gap and no line", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Kitchen",
        hasUnconfirmed: false,
        quantities: [{ kind: "ceiling_sqft", value: 120, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], []); // no ceiling service in the pricebook
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([]);
    expect(result.value.gaps).toEqual([{ kind: "ceiling_sqft", label: "Ceiling" }]);
  });

  it("multiple services for the same kind: lowest position active one wins", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Bedroom",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 100, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [
      service({ name: "Premium paint", position: 5, unitPriceCents: 500 }),
      service({ name: "Standard paint", position: 1, unitPriceCents: 250 }),
      service({ name: "Mid paint", position: 3, unitPriceCents: 300 }),
    ]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toHaveLength(1);
    expect(result.value.seedLines[0]?.description).toBe("Bedroom — Standard paint");
    expect(result.value.seedLines[0]?.rateCents).toBe(250);
  });

  it("same-position services: the winner is independent of reader array order", async () => {
    // Two UI-created services both default to position 0 — a real, common tie, not an edge
    // case. The winner must be deterministic (position, then name, then id) regardless of which
    // order the reader happens to hand them back in — never dependent on Postgres heap order.
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Bedroom",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 100, status: "derived" }],
      },
    ];
    const svcA = service({
      id: asServiceId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      name: "Alpha paint",
      position: 0,
      unitPriceCents: 111,
    });
    const svcB = service({
      id: asServiceId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      name: "Beta paint",
      position: 0,
      unitPriceCents: 222,
    });

    const forward = build(rooms, [], [svcA, svcB]);
    const reversed = build(rooms, [], [svcB, svcA]);

    const forwardResult = await forward.exec({ jobId: JOB });
    const reversedResult = await reversed.exec({ jobId: JOB });
    expect(isOk(forwardResult)).toBe(true);
    expect(isOk(reversedResult)).toBe(true);
    if (!isOk(forwardResult) || !isOk(reversedResult)) return;

    // Alpha sorts before Beta by name — the deterministic tie-break, not array order.
    expect(forwardResult.value.seedLines[0]?.description).toBe("Bedroom — Alpha paint");
    expect(reversedResult.value.seedLines[0]?.description).toBe("Bedroom — Alpha paint");
    expect(forwardResult.value.seedLines).toEqual(reversedResult.value.seedLines);
  });

  it("a zero-value quantity seeds nothing", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Hallway",
        hasUnconfirmed: false,
        quantities: [{ kind: "doors_count", value: 0, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "doors_count" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([]);
    // No line was produced, but the kind WAS seen with a matching service — not a gap either.
    expect(result.value.gaps).toEqual([]);
  });

  it("an absent (filtered-out null) quantity seeds nothing and is not a gap", async () => {
    // RoomQuantitiesReader.readForJob already excludes null-valued rows — only non-null
    // quantities appear in `quantities`. A kind never captured for this room simply never
    // appears, so it does not seed a line and is not reported as a gap either.
    const rooms: RoomQuantitiesForJob[] = [
      { roomName: "Closet", hasUnconfirmed: false, quantities: [] },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "walls_sqft" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([]);
    expect(result.value.gaps).toEqual([]);
  });

  it("counts (doors/windows) quantity is the raw count", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Office",
        hasUnconfirmed: false,
        quantities: [{ kind: "doors_count", value: 3, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "doors_count", name: "Door painting" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines[0]?.quantity).toBe(3);
  });

  it("hasUnconfirmed rooms are listed but their resolved quantities still seed", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Attic",
        hasUnconfirmed: true, // e.g. a vaulted ceiling still needs_confirm
        quantities: [{ kind: "walls_sqft", value: 180, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "walls_sqft" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.unconfirmedRooms).toEqual(["Attic"]);
    expect(result.value.seedLines).toHaveLength(1);
  });

  it("multiple rooms with the same kind each produce their own line", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Room A",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 100, status: "derived" }],
      },
      {
        roomName: "Room B",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 200, status: "derived" }],
      },
    ];
    const useCase = build(rooms, [], [service({ measuredBy: "walls_sqft" })]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines.map((l) => l.sourceName)).toEqual(["Room A", "Room B"]);
  });

  it("a flat traced surface seeds an area line and a perimeter line from its per-sqft/per-lnft services", async () => {
    const sealSvc = service({
      id: asServiceId("55555555-5555-5555-5555-555555555555"),
      name: "Seal coating",
      measuredBy: "site_sqft",
      unitPriceCents: 1400,
      costCents: 400,
    });
    const edgeSvc = service({
      id: asServiceId("66666666-6666-6666-6666-666666666666"),
      name: "Edge restraint",
      measuredBy: "site_lnft",
      unitPriceCents: 800,
      costCents: 200,
    });
    const useCase = build([], [flatSite()], [sealSvc, edgeSvc]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([
      {
        description: "Driveway — Seal coating",
        quantity: 640,
        rateCents: 1400,
        costCents: 400,
        measuredKind: "site_sqft",
        sourceName: "Driveway",
        serviceId: sealSvc.id,
      },
      {
        description: "Driveway — Edge restraint",
        quantity: 104,
        rateCents: 800,
        costCents: 200,
        measuredKind: "site_lnft",
        sourceName: "Driveway",
        serviceId: edgeSvc.id,
      },
    ]);
    expect(result.value.gaps).toEqual([]);
  });

  it("a pitched surface seeds the CORRECTED roof area and names its pitch in the line", async () => {
    // areaSqft is already pitch-corrected by the domain (1282 sqft footprint at 6/12 ≈ 1433) —
    // the use-case must pass it through untouched and label the source with the pitch, never
    // fall back to the raw footprint.
    const roofSvc = service({ name: "Shingle install", measuredBy: "site_sqft", unitPriceCents: 550 });
    const useCase = build(
      [],
      [flatSite({ name: "Main roof", surface: "pitched", pitchRise: 6, areaSqft: 1433.35, perimeterLnft: null })],
      [roofSvc],
    );
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([
      {
        description: "Main roof at 6/12 — Shingle install",
        quantity: 1433.35,
        rateCents: 550,
        costCents: 90,
        measuredKind: "site_sqft",
        sourceName: "Main roof at 6/12",
        serviceId: roofSvc.id,
      },
    ]);
  });

  it("a surface with no priced site service surfaces a Site area gap", async () => {
    const useCase = build([], [flatSite()], []); // pricebook has no site-priced services
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toEqual([]);
    expect(result.value.gaps).toEqual([
      { kind: "site_sqft", label: "Site area" },
      { kind: "site_lnft", label: "Site perimeter" },
    ]);
  });

  it("a manual capture with no perimeter neither seeds a lnft line nor reports a lnft gap", async () => {
    const sealSvc = service({ name: "Seal coating", measuredBy: "site_sqft" });
    const useCase = build([], [flatSite({ name: "Back patio", perimeterLnft: null, areaSqft: 300 })], [sealSvc]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toHaveLength(1);
    expect(result.value.seedLines[0]?.measuredKind).toBe("site_sqft");
    expect(result.value.gaps).toEqual([]);
  });

  it("rooms and surfaces seed side by side on the same job", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Living Room",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 240, status: "derived" }],
      },
    ];
    const wallsSvc = service({ measuredBy: "walls_sqft" });
    const siteSvc = service({
      id: asServiceId("77777777-7777-7777-7777-777777777777"),
      name: "Seal coating",
      measuredBy: "site_sqft",
    });
    const useCase = build(rooms, [flatSite({ perimeterLnft: null })], [wallsSvc, siteSvc]);
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines.map((l) => l.description)).toEqual([
      "Living Room — Paint walls",
      "Driveway — Seal coating",
    ]);
  });

  // ---- sourceNames filter (the composer's per-surface "Seed lines") --------
  describe("sourceNames filter", () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Living Room",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 240, status: "derived" }],
      },
      {
        roomName: "Kitchen",
        hasUnconfirmed: true,
        quantities: [{ kind: "walls_sqft", value: 180, status: "needs_confirm" }],
      },
    ];
    const services = [
      service({ measuredBy: "walls_sqft" }),
      service({
        id: asServiceId("77777777-7777-7777-7777-777777777777"),
        name: "Seal coating",
        measuredBy: "site_sqft",
      }),
    ];

    it("absent sourceNames seeds the whole job (backward-compatible)", async () => {
      const useCase = build(rooms, [flatSite({ perimeterLnft: null })], services);
      const result = await useCase.exec({ jobId: JOB });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.seedLines).toHaveLength(3);
    });

    it("seeds only the named capture's lines", async () => {
      const useCase = build(rooms, [flatSite({ perimeterLnft: null })], services);
      const result = await useCase.exec({ jobId: JOB, sourceNames: ["Driveway"] });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.seedLines.map((l) => l.description)).toEqual(["Driveway — Seal coating"]);
      // Excluded captures contribute nothing — not even unconfirmed flags.
      expect(result.value.unconfirmedRooms).toEqual([]);
    });

    it("filters PITCHED sites by their stored name, not the pitch-decorated sourceName", async () => {
      const pitched = flatSite({
        name: "Main roof",
        surface: "pitched",
        pitchRise: 6,
        perimeterLnft: null,
      });
      const useCase = build([], [pitched], services);
      const result = await useCase.exec({ jobId: JOB, sourceNames: ["Main roof"] });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.seedLines.map((l) => l.sourceName)).toEqual(["Main roof at 6/12"]);
    });

    it("a name matching nothing yields an empty seed, not an error", async () => {
      const useCase = build(rooms, [flatSite()], services);
      const result = await useCase.exec({ jobId: JOB, sourceNames: ["Nope"] });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.seedLines).toEqual([]);
      expect(result.value.gaps).toEqual([]);
    });

    it("matches trimmed names", async () => {
      const useCase = build(rooms, [], services);
      const result = await useCase.exec({ jobId: JOB, sourceNames: ["  Living Room  "] });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.seedLines.map((l) => l.sourceName)).toEqual(["Living Room"]);
    });
  });
});
