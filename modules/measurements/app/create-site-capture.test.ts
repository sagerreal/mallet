import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, isErr, type OrgId, type JobId } from "@mallet/shared/types";
import type { SiteCapture, SitePolygon } from "../domain/site-capture";
import { JobNotFoundError, type MeasurementRepository } from "../domain/measurement-repository";
import { CreateSiteCaptureUseCase, type CreateSiteCaptureCommand } from "./create-site-capture";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const polygon: SitePolygon = {
  vertices: [
    { lat: 35.771, lng: -78.638 },
    { lat: 35.7712, lng: -78.638 },
    { lat: 35.7712, lng: -78.6378 },
  ],
  view: { centerLat: 35.7711, centerLng: -78.6379, zoom: 20 },
};

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in create-site-capture tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in create-site-capture tests");
  }
  createSiteCaptureCalls: SiteCapture[] = [];
  createSiteCaptureThrows: Error | null = null;

  async createSiteCapture(capture: SiteCapture): Promise<void> {
    if (this.createSiteCaptureThrows) throw this.createSiteCaptureThrows;
    this.createSiteCaptureCalls.push(capture);
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in create-site-capture tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in create-site-capture tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in create-site-capture tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in create-site-capture tests");
  }

  async createCapture(): Promise<never> {
    throw new Error("createCapture not used in create-site-capture tests");
  }

  async listByJob(): Promise<never> {
    throw new Error("listByJob not used in create-site-capture tests");
  }

  async getCapture(): Promise<never> {
    throw new Error("getCapture not used in create-site-capture tests");
  }

  async supersede(): Promise<never> {
    throw new Error("supersede not used in create-site-capture tests");
  }

  async setQuantity(): Promise<never> {
    throw new Error("setQuantity not used in create-site-capture tests");
  }

  async renameRoom(): Promise<never> {
    throw new Error("renameRoom not used in create-site-capture tests");
  }

  async archive(): Promise<never> {
    throw new Error("archive not used in create-site-capture tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

describe("CreateSiteCaptureUseCase", () => {
  let clock: FixedClock;
  let repo: FakeMeasurementRepository;
  let useCase: CreateSiteCaptureUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-30T12:00:00Z"));
    repo = new FakeMeasurementRepository();
    useCase = new CreateSiteCaptureUseCase(repo, clock, fixedIds());
  });

  const tracedCmd = (overrides: Partial<CreateSiteCaptureCommand> = {}): CreateSiteCaptureCommand => ({
    jobId: JOB,
    name: "Driveway",
    source: "aerial_trace_v1",
    surface: "flat",
    polygon,
    footprintSqft: 640,
    perimeterLnft: 104,
    ...overrides,
  });

  // ── traced captures: the server derives the working area ──────────────────

  it("uses the footprint as the working area for a flat traced surface", async () => {
    const result = await useCase.exec(tracedCmd(), ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.areaSqft).toBe(640);
      expect(result.value.props.footprintSqft).toBe(640);
    }
    expect(repo.createSiteCaptureCalls).toHaveLength(1);
  });

  it("derives a pitch-corrected working area for a pitched traced surface (never trusts a client area)", async () => {
    const result = await useCase.exec(
      tracedCmd({
        name: "Main roof — south face",
        surface: "pitched",
        pitchRise: 4,
        footprintSqft: 1000,
        // A client-sent area on a traced capture is ignored in favor of the derivation.
        areaSqft: 1,
      }),
      ORG,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.areaSqft).toBeCloseTo(1054.09, 2);
      expect(result.value.props.pitchRise).toBe(4);
    }
  });

  it("returns a validation error when a traced capture has no footprint", async () => {
    const result = await useCase.exec(tracedCmd({ footprintSqft: undefined }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
    expect(repo.createSiteCaptureCalls).toHaveLength(0);
  });

  it("returns a validation error when a traced capture has no polygon", async () => {
    const result = await useCase.exec(tracedCmd({ polygon: undefined }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  it("returns a validation error for a pitched surface without a pitch", async () => {
    const result = await useCase.exec(tracedCmd({ surface: "pitched" }), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  // ── manual captures: the caller types the area ────────────────────────────

  it("creates a manual capture from a typed area with no trace fields", async () => {
    const result = await useCase.exec(
      {
        jobId: JOB,
        name: "Back patio",
        source: "manual",
        surface: "flat",
        areaSqft: 320,
      },
      ORG,
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.areaSqft).toBe(320);
      expect(result.value.props.polygon).toBeNull();
      expect(result.value.props.footprintSqft).toBeNull();
    }
  });

  it("returns a validation error when a manual capture has no area", async () => {
    const result = await useCase.exec(
      { jobId: JOB, name: "Back patio", source: "manual", surface: "flat" },
      ORG,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("validation");
  });

  // ── plumbing ──────────────────────────────────────────────────────────────

  it("maps JobNotFoundError from the repository to a not_found result", async () => {
    repo.createSiteCaptureThrows = new JobNotFoundError(JOB);

    const result = await useCase.exec(tracedCmd(), ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });

  it("honors a client-authored id and mints one when absent", async () => {
    const withId = await useCase.exec(tracedCmd({ id: "11111111-1111-1111-1111-111111111111" }), ORG);
    expect(isOk(withId)).toBe(true);
    if (isOk(withId)) expect(withId.value.props.id).toBe("11111111-1111-1111-1111-111111111111");

    const minted = await useCase.exec(tracedCmd(), ORG);
    expect(isOk(minted)).toBe(true);
    if (isOk(minted)) expect(minted.value.props.id).toBe(MINTED_ID);
  });
});
