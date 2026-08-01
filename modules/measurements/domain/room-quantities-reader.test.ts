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
      { kind: "walls_sqft", value: 120.5, derivedValue: 120.5, status: "derived" },
      { kind: "doors_count", value: 2, derivedValue: 2, status: "derived" },
    ];
    repo.seed("job-1", [{ capture: makeCapture({ roomName: "Living Room" }), quantities }]);
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
      { kind: "ceiling_sqft", value: null, derivedValue: null, status: "needs_confirm" },
      { kind: "crown_lnft", value: 40, derivedValue: 40, status: "derived" },
    ];
    repo.seed("job-2", [{ capture: makeCapture({ roomName: "Bedroom" }), quantities }]);
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
      { kind: "walls_sqft", value: 200, derivedValue: 180, status: "override" },
    ];
    repo.seed("job-3", [{ capture: makeCapture({ roomName: "Hallway" }), quantities }]);
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
