import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "../domain/room-capture";
import type { MeasurementRepository, RoomCaptureWithQuantities } from "../domain/measurement-repository";
import { ListRoomsUseCase, type ListRoomsCommand } from "./list-rooms";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const OTHER_JOB: JobId = asJobId("55555555-5555-5555-5555-555555555555");

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
  listByJobCallCount = 0;
  listByJobLastArg: string | null = null;

  seed(jobId: string, rooms: RoomCaptureWithQuantities[]): void {
    this.byJob.set(jobId, rooms);
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in list tests");
  }

  async listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]> {
    this.listByJobCallCount += 1;
    this.listByJobLastArg = jobId;
    return this.byJob.get(jobId) ?? [];
  }

  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in list tests");
  }

  async supersede(): Promise<void> {
    throw new Error("supersede not used in list tests");
  }

  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in list tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in list tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in list tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in list tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in list tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in list tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in list tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in list tests");
  }
}

const fixedIds = () => ({ newId: () => "unused" });

describe("ListRoomsUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: ListRoomsUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new ListRoomsUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<ListRoomsCommand> = {}): ListRoomsCommand => ({
    jobId: JOB,
    ...overrides,
  });

  it("returns the repo's rooms as-is for a job that has captures", async () => {
    const room = { capture: makeCapture(), quantities: [] };
    repo.seed(JOB, [room]);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]).toBe(room);
    }
  });

  it("returns an empty array for a job with no current captures", async () => {
    const result = await useCase.exec(baseCmd({ jobId: OTHER_JOB }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toEqual([]);
  });

  it("passes the jobId through to repo.listByJob", async () => {
    await useCase.exec(baseCmd(), ORG);

    expect(repo.listByJobCallCount).toBe(1);
    expect(repo.listByJobLastArg).toBe(JOB);
  });
});
