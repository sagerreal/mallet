import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "../domain/room-capture";
import type { PaintingQuantity } from "../domain/derive-painting";
import {
  SupersedeTargetError,
  DuplicateCaptureError,
  JobNotFoundError,
  type MeasurementRepository,
  type RoomCaptureWithQuantities,
} from "../domain/measurement-repository";
import { RescanRoomUseCase, type RescanRoomCommand } from "./rescan-room";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const OLD_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const wireGeometry = {
  floor_polygon: {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 3 },
      { x: 0, y: 0, z: 3 },
    ],
  },
  walls: [
    {
      polygon: {
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
          { x: 4, y: 2.5, z: 0 },
          { x: 0, y: 2.5, z: 0 },
        ],
      },
    },
  ],
  openings: [],
  ceiling: null,
};

const baseOldProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: OLD_ID,
  orgId: ORG,
  jobId: JOB,
  roomName: "Living Room",
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

const makeOldCapture = (overrides: Partial<RoomCaptureProps> = {}): RoomCapture => {
  const r = RoomCapture.create(baseOldProps(overrides));
  if (!r.ok) throw new Error(`RoomCapture.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeMeasurementRepository ────────────────────────────────────────────────

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in rescan-room tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in rescan-room tests");
  }
  private byId = new Map<string, RoomCaptureWithQuantities>();
  supersedeCalls: { oldId: string; next: RoomCapture; quantities: readonly PaintingQuantity[] }[] = [];
  throwOnSupersede = false;
  throwOnSupersedeError: Error | null = null;

  seed(capture: RoomCapture, quantities: RoomCaptureWithQuantities["quantities"] = []): void {
    this.byId.set(capture.props.id, { capture, quantities, deductions: [] });
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in rescan tests");
  }

  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in rescan tests");
  }

  async getCapture(id: string): Promise<RoomCaptureWithQuantities | null> {
    return this.byId.get(id) ?? null;
  }

  async supersede(oldId: string, next: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void> {
    this.supersedeCalls.push({ oldId, next, quantities });
    if (this.throwOnSupersede) throw new SupersedeTargetError("stale supersede target");
    if (this.throwOnSupersedeError) throw this.throwOnSupersedeError;
  }

  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in rescan tests");
  }

  async setTrimHeight(): Promise<number> {
    throw new Error("setTrimHeight not used in rescan tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in rescan tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in rescan tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in rescan tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in rescan tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in rescan tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in rescan tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in rescan tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── RescanRoomUseCase ────────────────────────────────────────────────────────

describe("RescanRoomUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: RescanRoomUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new RescanRoomUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<RescanRoomCommand> = {}): RescanRoomCommand => ({
    captureId: OLD_ID,
    rawPayload: { source: "roomplan" },
    geometry: wireGeometry,
    capturedAt: new Date("2026-07-09T11:00:00Z"),
    ...overrides,
  });

  // ── geometry parse failure ────────────────────────────────────────────────

  it("returns a validation error when geometry is malformed and never reads or supersedes", async () => {
    const result = await useCase.exec(baseCmd({ geometry: { not: "geometry" } }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.supersedeCalls).toHaveLength(0);
  });

  // ── rescan of a stale/missing id → notFound(ish) result, not a throw (required edge test) ──

  it("returns a not_found result (not a throw) when the old capture id does not resolve", async () => {
    const result = await useCase.exec(baseCmd({ captureId: MISSING_ID }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
    expect(repo.supersedeCalls).toHaveLength(0);
  });

  it("maps a SupersedeTargetError thrown by the repo to a conflict result instead of throwing", async () => {
    repo.seed(makeOldCapture());
    repo.throwOnSupersede = true;

    await expect(useCase.exec(baseCmd(), ORG)).resolves.toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });
  });

  // ── happy path — inherits job + room name ─────────────────────────────────

  it("inherits the job id and room name of the capture it supersedes", async () => {
    repo.seed(makeOldCapture({ roomName: "Primary Bedroom" }));

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.capture.props.jobId).toBe(JOB);
      expect(result.value.capture.props.roomName).toBe("Primary Bedroom");
    }
  });

  it("mints a new id for the superseding capture and calls repo.supersede with the old id", async () => {
    repo.seed(makeOldCapture());

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.capture.props.id).toBe(MINTED_ID);
    expect(repo.supersedeCalls).toHaveLength(1);
    expect(repo.supersedeCalls[0]!.oldId).toBe(OLD_ID);
  });

  it("derives fresh quantities from the new geometry rather than inheriting old overrides", async () => {
    repo.seed(makeOldCapture(), [
      { kind: "walls_sqft", value: 999, derivedValue: 500, status: "override", heightIn: null },
    ]);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const walls = result.value.quantities.find((q) => q.kind === "walls_sqft");
      expect(walls?.status).toBe("derived");
      expect(walls?.value).not.toBe(999);
    }
  });

  // ── duplicate new-capture id → true idempotency, not a throw ──────────────

  it("returns the existing capture (ok) when the repo throws DuplicateCaptureError for the minted id", async () => {
    repo.seed(makeOldCapture());
    repo.throwOnSupersedeError = new DuplicateCaptureError(MINTED_ID);
    const existingResult = RoomCapture.create(
      baseOldProps({ id: MINTED_ID, roomName: "Already Rescanned" }),
    );
    if (!existingResult.ok) throw new Error("fixture setup failed");
    repo.seed(existingResult.value);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.capture.props.id).toBe(MINTED_ID);
      expect(result.value.capture.props.roomName).toBe("Already Rescanned");
    }
  });

  it("returns a conflict result (not a throw) when DuplicateCaptureError fires but getCapture then finds nothing", async () => {
    repo.seed(makeOldCapture());
    repo.throwOnSupersedeError = new DuplicateCaptureError(MINTED_ID);
    // No second seed(): getCapture(MINTED_ID) returns null — freak race.

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("conflict");
  });

  // ── defensive JobNotFoundError handling (cannot happen on rescan in practice) ─

  it("maps a defensive JobNotFoundError thrown by the repo to a not_found result instead of throwing", async () => {
    repo.seed(makeOldCapture());
    repo.throwOnSupersedeError = new JobNotFoundError(JOB);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });
});
