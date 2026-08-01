import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "../domain/room-capture";
import type { PaintingQuantity, PaintingQuantityKind } from "../domain/derive-painting";
import type {
  MeasurementRepository,
  QuantityStatus,
  RoomCaptureWithQuantities,
} from "../domain/measurement-repository";
import { OverrideQuantityUseCase, type OverrideQuantityCommand } from "./override-quantity";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const CAPTURE_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

const baseProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: CAPTURE_ID,
  orgId: ORG,
  jobId: JOB,
  roomName: "Living Room",
  source: "roomplan_v1",
  rawPayload: null,
  geometry: {
    floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] },
    walls: [],
    openings: [],
    ceiling: null,
  },
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

// ── FakeMeasurementRepository ────────────────────────────────────────────────

class FakeMeasurementRepository implements MeasurementRepository {
  private byId = new Map<string, RoomCaptureWithQuantities>();
  setQuantityCalls: { captureId: string; kind: PaintingQuantityKind; value: number | null; status: QuantityStatus }[] = [];
  setQuantityReturns = 1;

  seed(capture: RoomCapture, quantities: RoomCaptureWithQuantities["quantities"] = []): void {
    this.byId.set(capture.props.id, { capture, quantities });
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in override tests");
  }

  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in override tests");
  }

  async getCapture(id: string): Promise<RoomCaptureWithQuantities | null> {
    return this.byId.get(id) ?? null;
  }

  async supersede(): Promise<void> {
    throw new Error("supersede not used in override tests");
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
    throw new Error("renameRoom not used in override tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in override tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in override tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in override tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in override tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in override tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in override tests");
  }
}

const fixedIds = () => ({ newId: () => "unused" });

// ── OverrideQuantityUseCase ──────────────────────────────────────────────────

describe("OverrideQuantityUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: OverrideQuantityUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new OverrideQuantityUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<OverrideQuantityCommand> = {}): OverrideQuantityCommand => ({
    captureId: CAPTURE_ID,
    kind: "walls_sqft",
    value: 300,
    ...overrides,
  });

  // ── negative value → validation error (required edge test) ───────────────

  it("returns a validation error when the value is negative", async () => {
    repo.seed(makeCapture());

    const result = await useCase.exec(baseCmd({ value: -1 }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.setQuantityCalls).toHaveLength(0);
  });

  it("returns a validation error when the value is not finite", async () => {
    const result = await useCase.exec(baseCmd({ value: Number.NaN }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  // ── not found ─────────────────────────────────────────────────────────────

  it("returns a not_found error when the capture does not exist", async () => {
    const result = await useCase.exec(baseCmd({ captureId: MISSING_ID }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("returns a not_found error when setQuantity affects zero rows", async () => {
    repo.seed(makeCapture());
    repo.setQuantityReturns = 0;

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  // ── status transitions ───────────────────────────────────────────────────

  it("sets status 'override' on a roomplan_v1 (scanned) capture", async () => {
    repo.seed(makeCapture({ source: "roomplan_v1" }));

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe("override");
    expect(repo.setQuantityCalls[0]?.status).toBe("override");
  });

  it("sets status 'confirmed' (not 'override') on a manual capture", async () => {
    repo.seed(makeCapture({ source: "manual", geometry: null }));

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe("confirmed");
    expect(repo.setQuantityCalls[0]?.status).toBe("confirmed");
  });

  it("leaves derivedValue untouched from the pre-existing stored quantity", async () => {
    repo.seed(makeCapture({ source: "roomplan_v1" }), [
      { kind: "walls_sqft", value: 250, derivedValue: 250, status: "derived" },
    ]);

    const result = await useCase.exec(baseCmd({ value: 300 }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.derivedValue).toBe(250);
      expect(result.value.value).toBe(300);
    }
  });

  it("accepts a zero value (boundary of >= 0)", async () => {
    repo.seed(makeCapture());

    const result = await useCase.exec(baseCmd({ value: 0 }), ORG);

    expect(isOk(result)).toBe(true);
  });
});
