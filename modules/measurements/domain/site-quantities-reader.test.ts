import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, type OrgId, type JobId } from "@mallet/shared/types";
import { SiteCapture, type SiteCaptureProps, pitchCorrectedArea } from "./site-capture";
import type { MeasurementRepository } from "./measurement-repository";
import { MeasurementSiteQuantitiesReader } from "./site-quantities-reader";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");

const TRIANGLE = {
  vertices: [
    { lat: 35.0, lng: -80.0 },
    { lat: 35.0001, lng: -80.0 },
    { lat: 35.0, lng: -80.0001 },
  ],
  view: { centerLat: 35.0, centerLng: -80.0, zoom: 20 },
};

const baseProps = (overrides: Partial<SiteCaptureProps> = {}): SiteCaptureProps => ({
  id: "44444444-4444-4444-4444-444444444444",
  orgId: ORG,
  jobId: JOB,
  name: "Driveway",
  source: "aerial_trace_v1",
  surface: "flat",
  pitchRise: null,
  polygon: TRIANGLE,
  footprintSqft: 640,
  areaSqft: 640,
  perimeterLnft: 104,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
  ...overrides,
});

const makeCapture = (overrides: Partial<SiteCaptureProps> = {}): SiteCapture => {
  const r = SiteCapture.create(baseProps(overrides));
  if (!r.ok) throw new Error(`SiteCapture.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

class FakeMeasurementRepository implements MeasurementRepository {
  private byJob = new Map<string, SiteCapture[]>();

  seed(jobId: string, captures: SiteCapture[]): void {
    this.byJob.set(jobId, captures);
  }

  async listSiteCaptures(jobId: string): Promise<SiteCapture[]> {
    return this.byJob.get(jobId) ?? [];
  }

  async createCapture(): Promise<never> {
    throw new Error("createCapture not used in reader tests");
  }

  async listByJob(): Promise<never> {
    throw new Error("listByJob not used in reader tests");
  }

  async getCapture(): Promise<never> {
    throw new Error("getCapture not used in reader tests");
  }

  async supersede(): Promise<never> {
    throw new Error("supersede not used in reader tests");
  }

  async setQuantity(): Promise<never> {
    throw new Error("setQuantity not used in reader tests");
  }

  async renameRoom(): Promise<never> {
    throw new Error("renameRoom not used in reader tests");
  }

  async archive(): Promise<never> {
    throw new Error("archive not used in reader tests");
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in reader tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in reader tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in reader tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in reader tests");
  }
}

describe("MeasurementSiteQuantitiesReader", () => {
  it("maps a flat traced capture to name + area + perimeter", async () => {
    const repo = new FakeMeasurementRepository();
    repo.seed("job-1", [makeCapture()]);
    const reader = new MeasurementSiteQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-1"));

    expect(result).toEqual([
      { name: "Driveway", surface: "flat", pitchRise: null, areaSqft: 640, perimeterLnft: 104 },
    ]);
  });

  it("passes the pitch-corrected working area through for a pitched surface, never the footprint", async () => {
    const repo = new FakeMeasurementRepository();
    const corrected = pitchCorrectedArea(1282, 6);
    repo.seed("job-2", [
      makeCapture({
        name: "Main roof",
        surface: "pitched",
        pitchRise: 6,
        footprintSqft: 1282,
        areaSqft: corrected,
      }),
    ]);
    const reader = new MeasurementSiteQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-2"));

    expect(result).toEqual([
      {
        name: "Main roof",
        surface: "pitched",
        pitchRise: 6,
        areaSqft: corrected,
        perimeterLnft: 104,
      },
    ]);
    expect(result[0]?.areaSqft).toBeGreaterThan(1282);
  });

  it("a manual capture carries a null perimeter", async () => {
    const repo = new FakeMeasurementRepository();
    repo.seed("job-3", [
      makeCapture({
        name: "Back patio",
        source: "manual",
        polygon: null,
        footprintSqft: null,
        perimeterLnft: null,
        areaSqft: 300,
      }),
    ]);
    const reader = new MeasurementSiteQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-3"));

    expect(result).toEqual([
      { name: "Back patio", surface: "flat", pitchRise: null, areaSqft: 300, perimeterLnft: null },
    ]);
  });

  it("returns an empty array for a job with no captures", async () => {
    const repo = new FakeMeasurementRepository();
    const reader = new MeasurementSiteQuantitiesReader(repo);

    const result = await reader.readForJob(asJobId("job-none"));

    expect(result).toEqual([]);
  });
});
