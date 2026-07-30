import { describe, it, expect } from "vitest";
import { asJobId, asLeadId, asServiceId, isOk, type JobId, type LeadId } from "@mallet/shared/types";
import type { RoomQuantitiesForJob, RoomQuantitiesReader } from "@mallet/measurements";
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

describe("BuildFromMeasurementsUseCase", () => {
  it("returns notFound when the job does not exist", async () => {
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(null),
      new FakeRoomQuantitiesReader([]),
      new FakeRateServicesReader([]),
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "walls_sqft" })]),
    );
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
        roomName: "Living Room",
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([]), // no ceiling service in the pricebook
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([
        service({ name: "Premium paint", position: 5, unitPriceCents: 500 }),
        service({ name: "Standard paint", position: 1, unitPriceCents: 250 }),
        service({ name: "Mid paint", position: 3, unitPriceCents: 300 }),
      ]),
    );
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines).toHaveLength(1);
    expect(result.value.seedLines[0]?.description).toBe("Bedroom — Standard paint");
    expect(result.value.seedLines[0]?.rateCents).toBe(250);
  });

  it("a zero-value quantity seeds nothing", async () => {
    const rooms: RoomQuantitiesForJob[] = [
      {
        roomName: "Hallway",
        hasUnconfirmed: false,
        quantities: [{ kind: "doors_count", value: 0, status: "derived" }],
      },
    ];
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "doors_count" })]),
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "walls_sqft" })]),
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "doors_count", name: "Door painting" })]),
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "walls_sqft" })]),
    );
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
    const useCase = new BuildFromMeasurementsUseCase(
      new FakeJobLeadReader(LEAD),
      new FakeRoomQuantitiesReader(rooms),
      new FakeRateServicesReader([service({ measuredBy: "walls_sqft" })]),
    );
    const result = await useCase.exec({ jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.seedLines.map((l) => l.roomName)).toEqual(["Room A", "Room B"]);
  });
});
