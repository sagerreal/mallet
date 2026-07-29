import { describe, it, expect, beforeEach } from "vitest";
import { asJobId, FixedClock, isOk, isErr, type JobId } from "@mallet/shared/types";
import type { RoomCapture } from "../domain/room-capture";
import type { PaintingQuantity } from "../domain/derive-painting";
import {
  SupersedeTargetError,
  type MeasurementRepository,
  type RoomCaptureWithQuantities,
} from "../domain/measurement-repository";
import { IngestScanUseCase, type IngestScanCommand } from "./ingest-scan";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG = "22222222-2222-2222-2222-222222222222";
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

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

// ── FakeMeasurementRepository ────────────────────────────────────────────────

class FakeMeasurementRepository implements MeasurementRepository {
  createCaptureCalls: { capture: RoomCapture; quantities: readonly PaintingQuantity[] }[] = [];

  async createCapture(capture: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void> {
    this.createCaptureCalls.push({ capture, quantities });
  }

  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in ingest tests");
  }

  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in ingest tests");
  }

  async supersede(): Promise<void> {
    throw new SupersedeTargetError("supersede not used in ingest tests");
  }

  async setQuantity(): Promise<number> {
    throw new Error("setQuantity not used in ingest tests");
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in ingest tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in ingest tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── IngestScanUseCase ────────────────────────────────────────────────────────

describe("IngestScanUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: IngestScanUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new IngestScanUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<IngestScanCommand> = {}): IngestScanCommand => ({
    jobId: JOB,
    roomName: "Living Room",
    capturedAt: new Date("2026-07-09T11:00:00Z"),
    rawPayload: { source: "roomplan" },
    geometry: wireGeometry,
    ...overrides,
  });

  // ── geometry parse failure ────────────────────────────────────────────────

  it("returns a validation error when geometry is malformed and never calls createCapture", async () => {
    const result = await useCase.exec(baseCmd({ geometry: { not: "geometry" } }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.createCaptureCalls).toHaveLength(0);
  });

  // ── >512KB raw payload → validation error (required edge test) ───────────

  it("returns a validation error when the raw payload exceeds 512KB", async () => {
    const hugePayload = { blob: "x".repeat(600 * 1024) };
    const result = await useCase.exec(baseCmd({ rawPayload: hugePayload }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("rawPayload");
    }
    expect(repo.createCaptureCalls).toHaveLength(0);
  });

  // ── room name validation surfaces through RoomCapture.create ─────────────

  it("returns a validation error when room name is empty", async () => {
    const result = await useCase.exec(baseCmd({ roomName: "   " }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === "validation") expect(result.error.field).toBe("roomName");
  });

  // ── happy path — id ─────────────────────────────────────────────────────

  it("mints an id via IdGenerator when none is provided", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.capture.props.id).toBe(MINTED_ID);
  });

  it("honors a client-authored id", async () => {
    const result = await useCase.exec(baseCmd({ id: CLIENT_ID }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.capture.props.id).toBe(CLIENT_ID);
  });

  // ── happy path — derivation + persistence ─────────────────────────────────

  it("derives quantities from the parsed geometry and persists them via createCapture", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    expect(repo.createCaptureCalls).toHaveLength(1);
    const persisted = repo.createCaptureCalls[0]!;
    expect(persisted.capture.props.source).toBe("roomplan_v1");
    expect(persisted.quantities.length).toBeGreaterThan(0);
  });

  it("sets derivedValue equal to value for derived quantities in the returned result", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const walls = result.value.quantities.find((q) => q.kind === "walls_sqft");
      expect(walls?.status).toBe("derived");
      expect(walls?.derivedValue).toBe(walls?.value);
    }
  });

  it("sets derivedValue null for needs_confirm quantities in the returned result", async () => {
    // no ceiling info in wireGeometry -> ceiling_sqft is needs_confirm
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const ceiling = result.value.quantities.find((q) => q.kind === "ceiling_sqft");
      expect(ceiling?.status).toBe("needs_confirm");
      expect(ceiling?.value).toBeNull();
      expect(ceiling?.derivedValue).toBeNull();
    }
  });

  it("builds the capture with the org, job, and captured-at timestamp from the command", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.capture.props.orgId).toBe(ORG);
      expect(result.value.capture.props.jobId).toBe(JOB);
      expect(result.value.capture.props.capturedAt.toISOString()).toBe("2026-07-09T11:00:00.000Z");
    }
  });
});
