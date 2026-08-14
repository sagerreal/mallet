import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, FixedClock, isOk, type OrgId, type JobId } from "@mallet/shared/types";
import { SiteCapture } from "../domain/site-capture";
import type { MeasurementRepository } from "../domain/measurement-repository";
import { ListSiteCapturesUseCase } from "./list-site-captures";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("33333333-3333-3333-3333-333333333333");
const NOW = new Date("2026-07-30T12:00:00Z");

const manualCapture = (id: string, name: string): SiteCapture => {
  const result = SiteCapture.create({
    id,
    orgId: ORG,
    jobId: JOB,
    name,
    source: "manual",
    surface: "flat",
    pitchRise: null,
    polygon: null,
    footprintSqft: null,
    areaSqft: 500,
    perimeterLnft: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  });
  if (!result.ok) throw new Error(`fixture invalid: ${result.error.message}`);
  return result.value;
};

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in list-site-captures tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in list-site-captures tests");
  }
  listSiteCapturesCalls: string[] = [];
  captures: SiteCapture[] = [];

  async listSiteCaptures(jobId: string): Promise<SiteCapture[]> {
    this.listSiteCapturesCalls.push(jobId);
    return this.captures;
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in list-site-captures tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in list-site-captures tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in list-site-captures tests");
  }

  async archiveSiteCapture(): Promise<never> {
    throw new Error("archiveSiteCapture not used in list-site-captures tests");
  }

  async createCapture(): Promise<never> {
    throw new Error("createCapture not used in list-site-captures tests");
  }

  async listByJob(): Promise<never> {
    throw new Error("listByJob not used in list-site-captures tests");
  }

  async getCapture(): Promise<never> {
    throw new Error("getCapture not used in list-site-captures tests");
  }

  async supersede(): Promise<never> {
    throw new Error("supersede not used in list-site-captures tests");
  }

  async setQuantity(): Promise<never> {
    throw new Error("setQuantity not used in list-site-captures tests");
  }

  async renameRoom(): Promise<never> {
    throw new Error("renameRoom not used in list-site-captures tests");
  }

  async archive(): Promise<never> {
    throw new Error("archive not used in list-site-captures tests");
  }
}

const fixedIds = () => ({ newId: () => "ffffffff-ffff-ffff-ffff-ffffffffffff" });

describe("ListSiteCapturesUseCase", () => {
  it("returns the repository's captures for the job as-is", async () => {
    const repo = new FakeMeasurementRepository();
    repo.captures = [
      manualCapture("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Driveway"),
      manualCapture("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Front walkway"),
    ];
    const useCase = new ListSiteCapturesUseCase(repo, new FixedClock(NOW), fixedIds());

    const result = await useCase.exec({ jobId: JOB }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.props.name).toBe("Driveway");
    }
    expect(repo.listSiteCapturesCalls).toEqual([JOB]);
  });

  it("returns an empty list when the job has no site captures", async () => {
    const repo = new FakeMeasurementRepository();
    const useCase = new ListSiteCapturesUseCase(repo, new FixedClock(NOW), fixedIds());

    const result = await useCase.exec({ jobId: JOB }, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toEqual([]);
  });
});
