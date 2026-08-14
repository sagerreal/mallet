import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "../domain/room-capture";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type {
  MeasurementRepository,
  QuantityStatus,
  RoomCaptureWithQuantities,
} from "../domain/measurement-repository";
import { ConfirmQuantityUseCase, type ConfirmQuantityCommand } from "./confirm-quantity";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const CAPTURE_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

const baseProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: CAPTURE_ID,
  orgId: ORG,
  jobId: JOB,
  roomName: "Great Room",
  source: "roomplan_v1",
  rawPayload: null,
  geometry: {
    floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] },
    walls: [],
    openings: [],
    ceiling: { area: null, isVaulted: true, wallTopSpread: null, provenance: null },
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
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in confirm-quantity tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in confirm-quantity tests");
  }
  private byId = new Map<string, RoomCaptureWithQuantities>();
  setQuantityCalls: { captureId: string; kind: PaintingQuantityKind; value: number | null; status: QuantityStatus }[] = [];
  setQuantityReturns = 1;

  seed(capture: RoomCapture, quantities: RoomCaptureWithQuantities["quantities"] = []): void {
    this.byId.set(capture.props.id, { capture, quantities, deductions: [] });
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in confirm tests");
  }

  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in confirm tests");
  }

  async getCapture(id: string): Promise<RoomCaptureWithQuantities | null> {
    return this.byId.get(id) ?? null;
  }

  async supersede(): Promise<void> {
    throw new Error("supersede not used in confirm tests");
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
    throw new Error("renameRoom not used in confirm tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in confirm tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in confirm tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in confirm tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in confirm tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in confirm tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in confirm tests");
  }
}

const fixedIds = () => ({ newId: () => "unused" });

// ── ConfirmQuantityUseCase ───────────────────────────────────────────────────

describe("ConfirmQuantityUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: ConfirmQuantityUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new ConfirmQuantityUseCase(repo, clock, fixedIds());
  });

  const baseCmd = (overrides: Partial<ConfirmQuantityCommand> = {}): ConfirmQuantityCommand => ({
    captureId: CAPTURE_ID,
    kind: "ceiling_sqft",
    value: 180,
    ...overrides,
  });

  // ── confirm on a non-needs_confirm row → error, surfaced not silent (required edge test) ──

  it("returns a conflict error when the quantity is not currently needs_confirm", async () => {
    repo.seed(makeCapture(), [
      { kind: "ceiling_sqft", value: 150, derivedValue: 150, status: "derived" },
    ]);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("conflict");
    expect(repo.setQuantityCalls).toHaveLength(0);
  });

  it("returns a conflict error when the quantity is already confirmed", async () => {
    repo.seed(makeCapture(), [
      { kind: "ceiling_sqft", value: 150, derivedValue: null, status: "confirmed" },
    ]);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("conflict");
  });

  // ── not found ─────────────────────────────────────────────────────────────

  it("returns a not_found error when the capture does not exist", async () => {
    const result = await useCase.exec(baseCmd({ captureId: MISSING_ID }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("returns a not_found error when no quantity row exists for that kind", async () => {
    repo.seed(makeCapture(), []);

    const result = await useCase.exec(baseCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  // ── validation ────────────────────────────────────────────────────────────

  it("returns a validation error when the value is negative", async () => {
    repo.seed(makeCapture(), [
      { kind: "ceiling_sqft", value: null, derivedValue: null, status: "needs_confirm" },
    ]);

    const result = await useCase.exec(baseCmd({ value: -1 }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("confirms a needs_confirm quantity, setting value and status 'confirmed'", async () => {
    repo.seed(makeCapture(), [
      { kind: "ceiling_sqft", value: null, derivedValue: null, status: "needs_confirm" },
    ]);

    const result = await useCase.exec(baseCmd({ value: 180 }), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.status).toBe("confirmed");
      expect(result.value.value).toBe(180);
    }
    expect(repo.setQuantityCalls).toContainEqual({
      captureId: CAPTURE_ID,
      kind: "ceiling_sqft",
      value: 180,
      status: "confirmed",
    });
  });
});
