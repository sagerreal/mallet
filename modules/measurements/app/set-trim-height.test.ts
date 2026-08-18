/**
 * Recording how tall a room's baseboard or crown is.
 *
 * The height is TYPED, not picked: real millwork runs 2¼", 3¼", 4", 5¼", 7", and plenty of
 * commercial work is a 4" rubber cove that matches no preset list at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import { RoomCapture, type RoomCaptureProps } from "../domain/room-capture";
import type { PaintingQuantityKind } from "../domain/derive-painting";
import type { TrimRunKind } from "../domain/trim-area";
import type {
  MeasurementRepository,
  QuantityStatus,
  RoomCaptureWithQuantities,
  StoredQuantity,
} from "../domain/measurement-repository";
import { SetTrimHeightUseCase } from "./set-trim-height";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const CAPTURE_ID = "44444444-4444-4444-4444-444444444444";
const MISSING_ID = "99999999-9999-9999-9999-999999999999";

const baseProps = (overrides: Partial<RoomCaptureProps> = {}): RoomCaptureProps => ({
  id: CAPTURE_ID,
  orgId: ORG,
  jobId: JOB,
  roomName: "Doctors office",
  source: "roomplan_v1",
  rawPayload: null,
  geometry: {
    floorPolygon: { vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }] },
    walls: [],
    openings: [],
    ceiling: null,
  },
  capturedAt: new Date("2026-08-01T00:00:00Z"),
  supersededById: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  deletedAt: null,
  ...overrides,
});

const makeCapture = (): RoomCapture => {
  const r = RoomCapture.create(baseProps());
  if (!r.ok) throw new Error(`RoomCapture.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

const quantity = (over: Partial<StoredQuantity> = {}): StoredQuantity => ({
  kind: "baseboard_lnft",
  value: 38.4,
  derivedValue: 38.4,
  status: "confirmed",
  heightIn: null,
  ...over,
});

class FakeMeasurementRepository implements MeasurementRepository {
  private byId = new Map<string, RoomCaptureWithQuantities>();
  heightCalls: { captureId: string; kind: TrimRunKind; heightIn: number | null }[] = [];
  setQuantityCalls: { kind: PaintingQuantityKind; status: QuantityStatus }[] = [];
  heightReturns = 1;

  seed(capture: RoomCapture, quantities: readonly StoredQuantity[]): void {
    this.byId.set(capture.props.id, { capture, quantities, deductions: [] });
  }

  async getCapture(id: string): Promise<RoomCaptureWithQuantities | null> {
    return this.byId.get(id) ?? null;
  }

  async setTrimHeight(captureId: string, kind: TrimRunKind, heightIn: number | null): Promise<number> {
    this.heightCalls.push({ captureId, kind, heightIn });
    return this.heightReturns;
  }

  async setQuantity(
    _captureId: string,
    kind: PaintingQuantityKind,
    patch: { value: number | null; status: QuantityStatus },
  ): Promise<number> {
    this.setQuantityCalls.push({ kind, status: patch.status });
    return 1;
  }

  async createCapture(): Promise<void> {
    throw new Error("createCapture not used in trim-height tests");
  }
  async listByJob(): Promise<RoomCaptureWithQuantities[]> {
    throw new Error("listByJob not used in trim-height tests");
  }
  async supersede(): Promise<void> {
    throw new Error("supersede not used in trim-height tests");
  }
  async renameRoom(): Promise<number> {
    throw new Error("renameRoom not used in trim-height tests");
  }
  async patchWallOverride(): Promise<Readonly<Record<number, number>> | null> {
    throw new Error("patchWallOverride not used in this test");
  }
  async archive(): Promise<number> {
    throw new Error("archive not used in trim-height tests");
  }
  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in trim-height tests");
  }
  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in trim-height tests");
  }
  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in trim-height tests");
  }
  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in trim-height tests");
  }
  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in trim-height tests");
  }
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in trim-height tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in trim-height tests");
  }
}

let repo: FakeMeasurementRepository;
const useCase = () => new SetTrimHeightUseCase(repo);

beforeEach(() => {
  repo = new FakeMeasurementRepository();
  repo.seed(makeCapture(), [quantity()]);
});

describe("setting a trim height", () => {
  it("records the typed height against the run", async () => {
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 5.25 },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    expect(repo.heightCalls).toEqual([
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 5.25 },
    ]);
  });

  it("takes any real millwork size, not a preset list", async () => {
    for (const h of [2.25, 3.25, 4, 5.25, 7, 9.5]) {
      repo = new FakeMeasurementRepository();
      repo.seed(makeCapture(), [quantity()]);
      const result = await useCase().exec(
        { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: h },
        ORG,
      );
      expect(isOk(result)).toBe(true);
    }
  });

  it("works the same for crown", async () => {
    repo.seed(makeCapture(), [quantity({ kind: "crown_lnft", value: 42 })]);
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "crown_lnft", heightIn: 7 },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    expect(repo.heightCalls[0]?.kind).toBe("crown_lnft");
  });

  it("clears the height with null — back to being priced by the foot", async () => {
    repo.seed(makeCapture(), [quantity({ heightIn: 5.25 })]);
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: null },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    expect(repo.heightCalls[0]?.heightIn).toBeNull();
  });

  /**
   * The reason this is its own use-case and not part of setQuantity's patch: typing a height
   * must not also confirm the run. A room where somebody noted the base height would otherwise
   * read as confirmed when nobody had checked what the scanner traced.
   */
  it("does NOT touch the run, its status, or its derived value", async () => {
    repo.seed(makeCapture(), [quantity({ value: 38.4, derivedValue: 40.1, status: "needs_confirm" })]);
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 5.25 },
      ORG,
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(repo.setQuantityCalls).toEqual([]);
    expect(result.value.value).toBe(38.4);
    expect(result.value.derivedValue).toBe(40.1);
    expect(result.value.status).toBe("needs_confirm");
    expect(result.value.heightIn).toBe(5.25);
  });
});

describe("refusing a height that means nothing", () => {
  it("refuses a kind that is not measured as a run", async () => {
    // Walls and ceilings are already areas; a door is not taller in square feet. Silently
    // dropping the write would leave the caller believing a number had been saved.
    for (const kind of ["walls_sqft", "ceiling_sqft", "soffit_sqft", "doors_count", "windows_count"] as const) {
      const result = await useCase().exec({ captureId: CAPTURE_ID, kind, heightIn: 5.25 }, ORG);
      expect(isErr(result)).toBe(true);
      if (!isErr(result)) return;
      expect(result.error.kind).toBe("validation");
    }
    expect(repo.heightCalls).toEqual([]);
  });

  it("refuses zero — 'no baseboard' is the None control, not a zero height", async () => {
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 0 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    expect(repo.heightCalls).toEqual([]);
  });

  it("refuses a negative height", async () => {
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: -4 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    expect(repo.heightCalls).toEqual([]);
  });

  it("refuses a height that is really panelling", async () => {
    // 36" is wainscot — a wall surface — and far likelier a slip for 3.6.
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 36 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe("validation");
  });
});

describe("when the room or the row is not there", () => {
  it("returns notFound for a capture that does not exist", async () => {
    const result = await useCase().exec(
      { captureId: MISSING_ID, kind: "baseboard_lnft", heightIn: 5.25 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe("not_found");
    expect(repo.heightCalls).toEqual([]);
  });

  it("returns notFound when the room has no such quantity row", async () => {
    repo.seed(makeCapture(), [quantity({ kind: "walls_sqft" })]);
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 5.25 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe("not_found");
  });

  /**
   * The no-silent-fail contract: zero affected rows means the write did not land (archived room,
   * wrong org), and the caller must be told rather than shown a success carrying the value it
   * just sent.
   */
  it("returns notFound when the update affects no rows", async () => {
    repo.heightReturns = 0;
    const result = await useCase().exec(
      { captureId: CAPTURE_ID, kind: "baseboard_lnft", heightIn: 5.25 },
      ORG,
    );
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe("not_found");
  });
});
