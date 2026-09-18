import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, FixedClock, isOk, isErr, type OrgId } from "@mallet/shared/types";
import type { MeasurementRepository, RoomCaptureWithQuantities } from "../domain/measurement-repository";
import { RenameRoomUseCase, type RenameRoomCommand } from "./rename-room";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CAPTURE_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in rename-room tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in rename-room tests");
  }
  renameCallCount = 0;
  renameLastArgs: { captureId: string; roomName: string } | null = null;
  renameReturns = 1;

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in rename tests");
  }
  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in rename tests");
  }
  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in rename tests");
  }
  async supersede(): Promise<void> {
    throw new Error("supersede not used in rename tests");
  }
  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in rename tests");
  }
  async setTrimHeight(): Promise<number> {
    throw new Error("setTrimHeight not used in rename tests");
  }

  async renameRoom(captureId: string, roomName: string): Promise<number> {
    this.renameCallCount += 1;
    this.renameLastArgs = { captureId, roomName };
    return this.renameReturns;
  }
  async patchWallOverride(): Promise<Readonly<Record<number, number>> | null> {
    throw new Error("patchWallOverride not used in this test");
  }
  async archive(): Promise<number> {
    throw new Error("archive not used in rename tests");
  }
  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in rename tests");
  }
  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in rename tests");
  }
  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in rename tests");
  }
  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in rename tests");
  }
  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in rename tests");
  }
}

const fixedIds = () => ({ newId: () => "unused" });

describe("RenameRoomUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: RenameRoomUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new RenameRoomUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<RenameRoomCommand> = {}): RenameRoomCommand => ({
    captureId: CAPTURE_ID,
    roomName: "New Room Name",
    ...overrides,
  });

  it("returns a validation error for an empty room name and never calls renameRoom", async () => {
    const result = await useCase.exec(baseCmd({ roomName: "   " }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.renameCallCount).toBe(0);
  });

  it("returns a validation error for a room name over 80 characters", async () => {
    const result = await useCase.exec(baseCmd({ roomName: "x".repeat(81) }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  it("trims the room name before calling renameRoom", async () => {
    await useCase.exec(baseCmd({ roomName: "  Bonus Room  " }), ORG);

    expect(repo.renameLastArgs?.roomName).toBe("Bonus Room");
  });

  it("returns a not_found error when renameRoom affects zero rows", async () => {
    repo.renameReturns = 0;

    const result = await useCase.exec(baseCmd({ captureId: MISSING_ID }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("returns ok with the renamed room on success", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.captureId).toBe(CAPTURE_ID);
      expect(result.value.roomName).toBe("New Room Name");
    }
  });
});
