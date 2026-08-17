import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "./room-capture";
import type { MeasurementRepository, RoomCaptureWithQuantities, StoredQuantity } from "./measurement-repository";
import { MeasurementRoomQuantitiesReader } from "./room-quantities-reader";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");

const baseProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: "44444444-4444-4444-4444-444444444444",
  orgId: ORG,
  jobId: JOB,
  roomName: "Kitchen",
  source: "manual",
  rawPayload: null,
  geometry: null,
  capturedAt: new Date("2026-07-01T00:00:00Z"),
  supersededById: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
  ...overrides,
});

const makeCapture = (overrides: Partial<RoomCaptureProps> = {}): RoomCapture => {
  const r = RoomCapture.create(baseProps(overrides));
  if (!r.ok) throw new Error(`RoomCapture.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in room-quantities-reader tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in room-quantities-reader tests");
  }
  private byJob = new Map<string, RoomCaptureWithQuantities[]>();

  seed(jobId: string, rooms: RoomCaptureWithQuantities[]): void {
    this.byJob.set(jobId, rooms);
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in reader tests");
  }

  async listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]> {
    return this.byJob.get(jobId) ?? [];
  }

  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in reader tests");
  }

  async supersede(): Promise<void> {
    throw new Error("supersede not used in reader tests");
  }

  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in reader tests");
  }

  async setTrimHeight(): Promise<number> {
    throw new Error("setTrimHeight not used in reader tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in reader tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in reader tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in reader tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in reader tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in reader tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in reader tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in reader tests");
  }
}

describe("MeasurementRoomQuantitiesReader", () => {
  it("returns only non-null quantities for an all-derived room, with hasUnconfirmed false", async () => {
    const repo = new FakeMeasurementRepository();
    const quantities: StoredQuantity[] = [
      { kind: "walls_sqft", value: 120.5, derivedValue: 120.5, status: "derived", heightIn: null },
      { kind: "doors_count", value: 2, derivedValue: 2, status: "derived", heightIn: null },
    ];
    repo.seed("job-1", [{ capture: makeCapture({ roomName: "Living Room" }), quantities, deductions: [] }]);
    const reader = new MeasurementRoomQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-1"));

    expect(result).toEqual([
      {
        roomName: "Living Room",
        hasUnconfirmed: false,
        quantities: [
          { kind: "walls_sqft", value: 120.5, status: "derived" },
          { kind: "doors_count", value: 2, status: "derived" },
        ],
      },
    ]);
  });

  it("marks hasUnconfirmed true and omits the null needs_confirm row from quantities", async () => {
    const repo = new FakeMeasurementRepository();
    const quantities: StoredQuantity[] = [
      { kind: "ceiling_sqft", value: null, derivedValue: null, status: "needs_confirm", heightIn: null },
      { kind: "crown_lnft", value: 40, derivedValue: 40, status: "derived", heightIn: null },
    ];
    repo.seed("job-2", [{ capture: makeCapture({ roomName: "Bedroom" }), quantities, deductions: [] }]);
    const reader = new MeasurementRoomQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-2"));

    expect(result).toEqual([
      {
        roomName: "Bedroom",
        hasUnconfirmed: true,
        quantities: [{ kind: "crown_lnft", value: 40, status: "derived" }],
      },
    ]);
  });

  it("includes an override value (user-changed) in quantities", async () => {
    const repo = new FakeMeasurementRepository();
    const quantities: StoredQuantity[] = [
      { kind: "walls_sqft", value: 200, derivedValue: 180, status: "override", heightIn: null },
    ];
    repo.seed("job-3", [{ capture: makeCapture({ roomName: "Hallway" }), quantities, deductions: [] }]);
    const reader = new MeasurementRoomQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-3"));

    expect(result).toEqual([
      {
        roomName: "Hallway",
        hasUnconfirmed: false,
        quantities: [{ kind: "walls_sqft", value: 200, status: "override" }],
      },
    ]);
  });

  it("returns an empty array for a job with no current rooms", async () => {
    const repo = new FakeMeasurementRepository();
    const reader = new MeasurementRoomQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-none"));

    expect(result).toEqual([]);
  });
});


/**
 * A trim run with a typed height offers BOTH bases — the length the scanner traced and the face
 * area that length and height make. Which one becomes a quote line is a pricebook question this
 * reader has no business answering, so it hands over both and lets BuildFromMeasurementsUseCase
 * pick exactly one.
 */
describe("a trim run whose height has been typed", () => {
  const readRoom = async (quantities: StoredQuantity[], job = "job-trim") => {
    const repo = new FakeMeasurementRepository();
    repo.seed(job, [{ capture: makeCapture({ roomName: "Doctors office" }), quantities, deductions: [] }]);
    const result = await new MeasurementRoomQuantitiesReader(repo).readForJob(asJobId(job));
    return result[0];
  };

  it("offers the area alongside the run", async () => {
    // 38.4 ln ft of 5¼" base = 16.8 sq ft of face.
    const room = await readRoom([
      { kind: "baseboard_lnft", value: 38.4, derivedValue: 38.4, status: "confirmed", heightIn: 5.25 },
    ]);
    expect(room?.quantities).toEqual([
      { kind: "baseboard_lnft", value: 38.4, status: "confirmed" },
      { kind: "baseboard_sqft", value: 16.8, status: "confirmed" },
    ]);
  });

  it("offers only the run when no height has been typed", async () => {
    const room = await readRoom([
      { kind: "baseboard_lnft", value: 38.4, derivedValue: 38.4, status: "confirmed", heightIn: null },
    ]);
    expect(room?.quantities).toEqual([{ kind: "baseboard_lnft", value: 38.4, status: "confirmed" }]);
  });

  it("does the same for crown", async () => {
    const room = await readRoom([
      { kind: "crown_lnft", value: 42, derivedValue: 42, status: "confirmed", heightIn: 6 },
    ]);
    expect(room?.quantities).toContainEqual({ kind: "crown_sqft", value: 21, status: "confirmed" });
  });

  it("never invents an area for a kind that is already one", async () => {
    // A height is impossible on these (the DB CHECK refuses it), but the reader must not depend
    // on that to behave — walls are an area already and have no run to convert.
    const room = await readRoom([
      { kind: "walls_sqft", value: 400.4, derivedValue: 400.4, status: "derived", heightIn: null },
    ]);
    expect(room?.quantities).toEqual([{ kind: "walls_sqft", value: 400.4, status: "derived" }]);
  });

  it("carries the run's own status onto the area", async () => {
    // The area is the same measurement seen another way — an overridden run does not become a
    // confident area just because somebody typed how tall the trim is.
    const room = await readRoom([
      { kind: "baseboard_lnft", value: 38.4, derivedValue: 40, status: "override", heightIn: 4 },
    ]);
    expect(room?.quantities.find((q) => q.kind === "baseboard_sqft")?.status).toBe("override");
  });
});
