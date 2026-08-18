import { describe, it, expect, beforeEach, vi } from "vitest";
import { AddDeductionUseCase } from "./add-deduction";
import { ArchiveDeductionUseCase } from "./archive-deduction";
import { RoomCapture } from "../domain/room-capture";
import { asOrgId, asJobId } from "@mallet/shared/types";
import { CaptureNotFoundError } from "../domain/measurement-repository";
import type {
  MeasurementRepository,
  RoomCaptureWithQuantities,
  StoredDeduction,
} from "../domain/measurement-repository";

const CAPTURE = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const NEW_ID = "44444444-4444-4444-8444-444444444444";

const geometry = {
  floor_polygon: { vertices: [] },
  walls: [
    { polygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 2.4, z: 0 }, { x: 0, y: 2.4, z: 0 }] } },
  ],
  openings: [],
  ceiling: null,
};

const makeCapture = (source: "roomplan_v1" | "manual"): RoomCapture => {
  const result = RoomCapture.create({
    id: CAPTURE,
    orgId: asOrgId(ORG),
    jobId: asJobId(JOB),
    roomName: "Bathroom",
    source,
    rawPayload: null,
    geometry: source === "manual" ? null : (geometry as never),
    capturedAt: new Date("2026-08-14T10:00:00Z"),
    supersededById: null,
    createdAt: new Date("2026-08-14T10:00:00Z"),
    updatedAt: new Date("2026-08-14T10:00:00Z"),
    deletedAt: null,
  });
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.error)}`);
  return result.value;
};

class FakeRepo implements MeasurementRepository {
  capture: RoomCaptureWithQuantities | null = null;
  added: { captureId: string; deduction: StoredDeduction }[] = [];
  addThrows: Error | null = null;
  archiveDeductionReturns = 1;
  archivedDeductionId: string | null = null;

  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    return this.capture;
  }
  async addDeduction(captureId: string, deduction: StoredDeduction): Promise<void> {
    if (this.addThrows) throw this.addThrows;
    this.added.push({ captureId, deduction });
  }
  async archiveDeduction(deductionId: string): Promise<number> {
    this.archivedDeductionId = deductionId;
    return this.archiveDeductionReturns;
  }
  async createCapture(): Promise<void> {
    throw new Error("unused");
  }
  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("unused");
  }
  async supersede(): Promise<void> {
    throw new Error("unused");
  }
  async setQuantity(): Promise<number> {
    throw new Error("unused");
  }
  async setTrimHeight(): Promise<number> {
    throw new Error("setTrimHeight not used in deduction tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("unused");
  }
  async patchWallOverride(): Promise<Readonly<Record<number, number>> | null> {
    throw new Error("patchWallOverride not used in this test");
  }
  async archive(): Promise<number> {
    throw new Error("unused");
  }
  async createSiteCapture(): Promise<void> {
    throw new Error("unused");
  }
  async getSiteCapture(): Promise<never> {
    throw new Error("unused");
  }
  async listSiteCapturesByJob(): Promise<never> {
    throw new Error("unused");
  }
  async listSiteCaptures(): Promise<never> {
    throw new Error("unused");
  }
  async updateSiteCapture(): Promise<number> {
    throw new Error("unused");
  }
  async archiveSiteCapture(): Promise<number> {
    throw new Error("unused");
  }
}

describe("AddDeductionUseCase", () => {
  let repo: FakeRepo;
  let useCase: AddDeductionUseCase;

  beforeEach(() => {
    repo = new FakeRepo();
    repo.capture = { capture: makeCapture("roomplan_v1"), quantities: [], deductions: [] };
    useCase = new AddDeductionUseCase(repo, { newId: () => NEW_ID });
  });

  const cmd = (over: Partial<Parameters<AddDeductionUseCase["exec"]>[0]> = {}) => ({
    captureId: CAPTURE,
    reason: "Tile wainscot",
    kind: "band" as const,
    wallIndexes: [0],
    heightM: 1.2,
    ...over,
  });

  it("stores the painter's inputs and never an area", async () => {
    const result = await useCase.exec(cmd(), ORG);
    expect(result.ok).toBe(true);
    const stored = repo.added[0]!.deduction;
    expect(stored).toEqual({
      id: NEW_ID,
      reason: "Tile wainscot",
      kind: "band",
      wallIndexes: [0],
      heightM: 1.2,
    });
    // The area is derived on read from the capture's geometry — storing one would go stale
    // the moment the room is re-scanned.
    expect(stored).not.toHaveProperty("sqft");
  });

  it("collapses a wall named twice and sorts, so the count reads true", async () => {
    await useCase.exec(cmd({ wallIndexes: [2, 0, 2] }), ORG);
    expect(repo.added[0]!.deduction.wallIndexes).toEqual([0, 2]);
  });

  it("trims the reason", async () => {
    await useCase.exec(cmd({ reason: "  Shower surround  " }), ORG);
    expect(repo.added[0]!.deduction.reason).toBe("Shower surround");
  });

  describe("refusals", () => {
    it("needs a reason — an unexplained deduction is the thing this replaces", async () => {
      const r = await useCase.exec(cmd({ reason: "   " }), ORG);
      expect(r.ok).toBe(false);
      expect(repo.added).toHaveLength(0);
    });

    it("rejects a reason past the column's own limit rather than letting the DB do it", async () => {
      const r = await useCase.exec(cmd({ reason: "x".repeat(61) }), ORG);
      expect(r.ok).toBe(false);
    });

    it("needs at least one wall", async () => {
      const r = await useCase.exec(cmd({ wallIndexes: [] }), ORG);
      expect(r.ok).toBe(false);
    });

    it("rejects a non-integer wall index — it would look up as undefined and derive zero", async () => {
      const r = await useCase.exec(cmd({ wallIndexes: [1.5] }), ORG);
      expect(r.ok).toBe(false);
    });

    it("rejects a negative wall index", async () => {
      const r = await useCase.exec(cmd({ wallIndexes: [-1] }), ORG);
      expect(r.ok).toBe(false);
    });

    it("refuses a band with no height", async () => {
      const r = await useCase.exec(cmd({ heightM: null }), ORG);
      expect(r.ok).toBe(false);
    });

    it("refuses a height that is not a room measurement", async () => {
      const r = await useCase.exec(cmd({ heightM: 40 }), ORG);
      expect(r.ok).toBe(false);
    });

    it("refuses a height on a whole-wall deduction — the whole wall goes either way", async () => {
      const r = await useCase.exec(cmd({ kind: "whole_wall", heightM: 1.2 }), ORG);
      expect(r.ok).toBe(false);
    });

    it("accepts a whole-wall deduction with no height", async () => {
      const r = await useCase.exec(cmd({ kind: "whole_wall", heightM: null }), ORG);
      expect(r.ok).toBe(true);
    });

    it("is not found when the capture does not resolve", async () => {
      repo.capture = null;
      const r = await useCase.exec(cmd(), ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("not_found");
    });

    // A manual room has no geometry, so there is no wall to point at and the deduction could
    // only ever derive to zero — a visible deduction that changes nothing.
    it("refuses a manual room and says to edit the wall area directly", async () => {
      repo.capture = { capture: makeCapture("manual"), quantities: [], deductions: [] };
      const r = await useCase.exec(cmd(), ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toMatch(/entered by hand/i);
    });

    // The capture was archived between the read and the insert.
    it("maps a capture FK violation to not_found rather than throwing", async () => {
      repo.addThrows = new CaptureNotFoundError(CAPTURE);
      const r = await useCase.exec(cmd(), ORG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("not_found");
    });

    it("rethrows an unexpected repository failure instead of swallowing it", async () => {
      repo.addThrows = new Error("connection reset");
      await expect(useCase.exec(cmd(), ORG)).rejects.toThrow("connection reset");
    });
  });
});

describe("ArchiveDeductionUseCase", () => {
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
    vi.clearAllMocks();
  });

  it("removes the deduction, putting the wall area back", async () => {
    const r = await new ArchiveDeductionUseCase(repo).exec({ deductionId: NEW_ID }, ORG);
    expect(r.ok).toBe(true);
    expect(repo.archivedDeductionId).toBe(NEW_ID);
  });

  // Removing a deduction changes what the job costs — a no-op reported as success would leave
  // the estimator looking at a number that never changed.
  it("surfaces not_found when nothing was removed, never a quiet success", async () => {
    repo.archiveDeductionReturns = 0;
    const r = await new ArchiveDeductionUseCase(repo).exec({ deductionId: NEW_ID }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
