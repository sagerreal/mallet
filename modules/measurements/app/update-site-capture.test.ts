import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import { SiteCapture, type SiteCaptureProps, type SitePolygon } from "../domain/site-capture";
import type { MeasurementRepository } from "../domain/measurement-repository";
import { UpdateSiteCaptureUseCase } from "./update-site-capture";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const CAPTURE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const NOW = new Date("2026-07-30T12:00:00Z");

const polygon: SitePolygon = {
  vertices: [
    { lat: 35.771, lng: -78.638 },
    { lat: 35.7712, lng: -78.638 },
    { lat: 35.7712, lng: -78.6378 },
  ],
  view: { centerLat: 35.7711, centerLng: -78.6379, zoom: 20 },
};

const tracedCapture = (overrides: Partial<SiteCaptureProps> = {}): SiteCapture => {
  const result = SiteCapture.create({
    id: CAPTURE_ID,
    orgId: ORG,
    jobId: JOB,
    name: "Main roof — south face",
    source: "aerial_trace_v1",
    surface: "flat",
    pitchRise: null,
    polygon,
    footprintSqft: 1000,
    areaSqft: 1000,
    perimeterLnft: 130,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture invalid: ${result.error.message}`);
  return result.value;
};

const manualCapture = (): SiteCapture =>
  tracedCapture({ source: "manual", polygon: null, footprintSqft: null, perimeterLnft: null, areaSqft: 500 });

class FakeMeasurementRepository implements MeasurementRepository {
  existing: SiteCapture | null = null;
  updateCalls: SiteCapture[] = [];
  updateReturns = 1;

  async getSiteCapture(): Promise<SiteCapture | null> {
    return this.existing;
  }

  async updateSiteCapture(capture: SiteCapture): Promise<number> {
    this.updateCalls.push(capture);
    return this.updateReturns;
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in update-site-capture tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in update-site-capture tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in update-site-capture tests");
  }

  async createCapture(): Promise<never> {
    throw new Error("createCapture not used in update-site-capture tests");
  }

  async listByJob(): Promise<never> {
    throw new Error("listByJob not used in update-site-capture tests");
  }

  async getCapture(): Promise<never> {
    throw new Error("getCapture not used in update-site-capture tests");
  }

  async supersede(): Promise<never> {
    throw new Error("supersede not used in update-site-capture tests");
  }

  async setQuantity(): Promise<never> {
    throw new Error("setQuantity not used in update-site-capture tests");
  }

  async renameRoom(): Promise<never> {
    throw new Error("renameRoom not used in update-site-capture tests");
  }

  async archive(): Promise<never> {
    throw new Error("archive not used in update-site-capture tests");
  }
}

const fixedIds = () => ({ newId: () => "ffffffff-ffff-ffff-ffff-ffffffffffff" });

describe("UpdateSiteCaptureUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: UpdateSiteCaptureUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-30T13:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new UpdateSiteCaptureUseCase(repo, clock, fixedIds());
  });

  it("returns not_found when the capture does not exist", async () => {
    repo.existing = null;

    const result = await useCase.exec({ captureId: CAPTURE_ID, name: "Roof" }, ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("renames without touching surface, pitch or area", async () => {
    repo.existing = tracedCapture();

    const result = await useCase.exec({ captureId: CAPTURE_ID, name: "Garage roof" }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Garage roof");
      expect(result.value.props.surface).toBe("flat");
      expect(result.value.props.areaSqft).toBe(1000);
    }
    expect(repo.updateCalls).toHaveLength(1);
  });

  it("recomputes the working area from the STORED footprint when the surface turns pitched", async () => {
    repo.existing = tracedCapture();

    const result = await useCase.exec(
      { captureId: CAPTURE_ID, surface: "pitched", pitchRise: 4 },
      ORG,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.pitchRise).toBe(4);
      expect(result.value.props.areaSqft).toBeCloseTo(1054.09, 2);
      expect(result.value.props.footprintSqft).toBe(1000);
    }
  });

  it("re-pitching an already-pitched surface recomputes the area from the new pitch", async () => {
    repo.existing = tracedCapture({ surface: "pitched", pitchRise: 4, areaSqft: 1054.09 });

    const result = await useCase.exec({ captureId: CAPTURE_ID, pitchRise: 12 }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.areaSqft).toBeCloseTo(1414.21, 2);
  });

  it("clears the pitch and restores the footprint area when the surface turns flat", async () => {
    repo.existing = tracedCapture({ surface: "pitched", pitchRise: 4, areaSqft: 1054.09 });

    const result = await useCase.exec({ captureId: CAPTURE_ID, surface: "flat" }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.pitchRise).toBeNull();
      expect(result.value.props.areaSqft).toBe(1000);
    }
  });

  it("requires a pitch when flipping flat to pitched", async () => {
    repo.existing = tracedCapture();

    const result = await useCase.exec({ captureId: CAPTURE_ID, surface: "pitched" }, ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  it("applies a typed area override to a manual capture", async () => {
    repo.existing = manualCapture();

    const result = await useCase.exec({ captureId: CAPTURE_ID, areaSqft: 750 }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.areaSqft).toBe(750);
  });

  it("rejects a typed area override on a traced capture", async () => {
    repo.existing = tracedCapture();

    const result = await useCase.exec({ captureId: CAPTURE_ID, areaSqft: 750 }, ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("returns not_found when the update affects zero rows (concurrent archive)", async () => {
    repo.existing = tracedCapture();
    repo.updateReturns = 0;

    const result = await useCase.exec({ captureId: CAPTURE_ID, name: "Roof" }, ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });
});
