import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import type { RoomCapture } from "../domain/room-capture";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import type {
  MeasurementRepository,
  QuantityStatus,
  RoomCaptureWithQuantities,
} from "../domain/measurement-repository";
import { CreateManualRoomUseCase, type CreateManualRoomCommand } from "./create-manual-room";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── FakeMeasurementRepository ────────────────────────────────────────────────

class FakeMeasurementRepository implements MeasurementRepository {
  createCaptureCalls: { capture: RoomCapture; quantities: readonly PaintingQuantity[] }[] = [];
  setQuantityCalls: { captureId: string; kind: PaintingQuantityKind; value: number | null; status: QuantityStatus }[] = [];
  setQuantityReturns = 1;

  async createCapture(capture: RoomCapture, quantities: readonly PaintingQuantity[]): Promise<void> {
    this.createCaptureCalls.push({ capture, quantities });
  }

  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in create-manual-room tests");
  }

  async getCapture(): Promise<RoomCaptureWithQuantities | null> {
    throw new Error("getCapture not used in create-manual-room tests");
  }

  async supersede(): Promise<void> {
    throw new Error("supersede not used in create-manual-room tests");
  }

  async setQuantity(
    captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<number> {
    this.setQuantityCalls.push({ captureId, kind, value: patch.value, status: patch.status });
    return this.setQuantityReturns;
  }

  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in create-manual-room tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in create-manual-room tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── CreateManualRoomUseCase ──────────────────────────────────────────────────

describe("CreateManualRoomUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: CreateManualRoomUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new CreateManualRoomUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<CreateManualRoomCommand> = {}): CreateManualRoomCommand => ({
    jobId: JOB,
    roomName: "Kitchen",
    quantities: [{ kind: "walls_sqft", value: 240 }],
    ...overrides,
  });

  // ── validation ────────────────────────────────────────────────────────────

  it("returns a validation error when a provided quantity value is negative", async () => {
    const result = await useCase.exec(
      baseCmd({ quantities: [{ kind: "walls_sqft", value: -5 }] }),
      ORG,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.createCaptureCalls).toHaveLength(0);
  });

  it("returns a validation error when a provided quantity value is not finite", async () => {
    const result = await useCase.exec(
      baseCmd({ quantities: [{ kind: "walls_sqft", value: Number.POSITIVE_INFINITY }] }),
      ORG,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  it("returns a validation error when room name is empty", async () => {
    const result = await useCase.exec(baseCmd({ roomName: "   " }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result) && result.error.kind === "validation") expect(result.error.field).toBe("roomName");
  });

  it("returns a validation error when the same quantity kind is supplied more than once", async () => {
    const result = await useCase.exec(
      baseCmd({
        quantities: [
          { kind: "walls_sqft", value: 240 },
          { kind: "walls_sqft", value: 300 },
        ],
      }),
      ORG,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.createCaptureCalls).toHaveLength(0);
  });

  // ── setQuantity silently missing a row must not be reported as success ────

  it("returns an error (not ok) when setQuantity affects zero rows for a provided quantity", async () => {
    repo.setQuantityReturns = 0;

    const result = await useCase.exec(baseCmd({ quantities: [{ kind: "walls_sqft", value: 240 }] }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("creates the capture with source 'manual' and no geometry", async () => {
    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.capture.props.source).toBe("manual");
      expect(result.value.capture.props.geometry).toBeNull();
    }
    expect(repo.createCaptureCalls).toHaveLength(1);
  });

  it("marks a caller-provided quantity as confirmed with the given value", async () => {
    const result = await useCase.exec(baseCmd({ quantities: [{ kind: "walls_sqft", value: 240 }] }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const walls = result.value.quantities.find((q) => q.kind === "walls_sqft");
      expect(walls?.status).toBe("confirmed");
      expect(walls?.value).toBe(240);
      expect(walls?.derivedValue).toBeNull();
    }
    expect(repo.setQuantityCalls).toContainEqual({
      captureId: MINTED_ID,
      kind: "walls_sqft",
      value: 240,
      status: "confirmed",
    });
  });

  it("marks kinds the caller did not supply as needs_confirm with a null value", async () => {
    const result = await useCase.exec(baseCmd({ quantities: [{ kind: "walls_sqft", value: 240 }] }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const ceiling = result.value.quantities.find((q) => q.kind === "ceiling_sqft");
      expect(ceiling?.status).toBe("needs_confirm");
      expect(ceiling?.value).toBeNull();
    }
  });

  it("returns a row for every painting quantity kind, not just the ones provided", async () => {
    const result = await useCase.exec(baseCmd({ quantities: [{ kind: "doors_count", value: 2 }] }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const kinds = result.value.quantities.map((q) => q.kind).sort();
      expect(kinds).toEqual(
        ["baseboard_lnft", "ceiling_sqft", "crown_lnft", "doors_count", "walls_sqft", "windows_count"].sort(),
      );
    }
  });

  it("honors a client-authored id", async () => {
    const result = await useCase.exec(baseCmd({ id: "11111111-1111-1111-1111-111111111111" }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.capture.props.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("supports creating a manual room with no quantities at all (all needs_confirm)", async () => {
    const result = await useCase.exec(baseCmd({ quantities: [] }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.quantities.every((q) => q.status === "needs_confirm")).toBe(true);
    }
    expect(repo.setQuantityCalls).toHaveLength(0);
  });
});
