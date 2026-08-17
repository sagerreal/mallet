import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, isErr, type OrgId } from "@mallet/shared/types";
import type { MeasurementRepository, RoomCaptureWithQuantities } from "../domain/measurement-repository";
import { ArchiveRoomUseCase, type ArchiveRoomCommand } from "./archive-room";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CAPTURE_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in archive-room tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in archive-room tests");
  }
  archiveCallCount = 0;
  archiveLastArg: string | null = null;
  archiveReturns = 1;

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in archive tests");
  }
  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in archive tests");
  }
  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in archive tests");
  }
  async supersede(): Promise<void> {
    throw new Error("supersede not used in archive tests");
  }
  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in archive tests");
  }
  async setTrimHeight(): Promise<number> {
    throw new Error("setTrimHeight not used in archive tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in archive tests");
  }
  async archive(captureId: string): Promise<number> {
    this.archiveCallCount += 1;
    this.archiveLastArg = captureId;
    return this.archiveReturns;
  }
  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in archive tests");
  }
  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in archive tests");
  }
  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in archive tests");
  }
  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in archive tests");
  }
  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in archive tests");
  }
}

const fixedIds = () => ({ newId: () => "unused" });

describe("ArchiveRoomUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: ArchiveRoomUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new ArchiveRoomUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<ArchiveRoomCommand> = {}): ArchiveRoomCommand => ({
    captureId: CAPTURE_ID,
    ...overrides,
  });

  it("returns a not_found error when the capture does not exist", async () => {
    repo.archiveReturns = 0;

    const result = await useCase.exec(baseCmd({ captureId: MISSING_ID }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("returns a not_found error when the capture was already archived (count === 0)", async () => {
    repo.archiveReturns = 0;

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("returns { ok: true } and calls archive exactly once on success", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.ok).toBe(true);
    expect(repo.archiveCallCount).toBe(1);
    expect(repo.archiveLastArg).toBe(CAPTURE_ID);
  });
});
