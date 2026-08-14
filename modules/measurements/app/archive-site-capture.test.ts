import { describe, it, expect } from "vitest";
import { asOrgId, FixedClock, isOk, isErr, type OrgId } from "@mallet/shared/types";
import type { MeasurementRepository } from "../domain/measurement-repository";
import { ArchiveSiteCaptureUseCase } from "./archive-site-capture";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CAPTURE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

class FakeMeasurementRepository implements MeasurementRepository {
  async addDeduction(): Promise<void> {
    throw new Error("addDeduction not used in archive-site-capture tests");
  }
  async archiveDeduction(): Promise<number> {
    throw new Error("archiveDeduction not used in archive-site-capture tests");
  }
  archiveSiteCaptureCalls: string[] = [];
  archiveSiteCaptureReturns = 1;

  async archiveSiteCapture(captureId: string): Promise<number> {
    this.archiveSiteCaptureCalls.push(captureId);
    return this.archiveSiteCaptureReturns;
  }

  async createSiteCapture(): Promise<never> {
    throw new Error("createSiteCapture not used in archive-site-capture tests");
  }

  async getSiteCapture(): Promise<never> {
    throw new Error("getSiteCapture not used in archive-site-capture tests");
  }

  async listSiteCaptures(): Promise<never> {
    throw new Error("listSiteCaptures not used in archive-site-capture tests");
  }

  async updateSiteCapture(): Promise<never> {
    throw new Error("updateSiteCapture not used in archive-site-capture tests");
  }

  async createCapture(): Promise<never> {
    throw new Error("createCapture not used in archive-site-capture tests");
  }

  async listByJob(): Promise<never> {
    throw new Error("listByJob not used in archive-site-capture tests");
  }

  async getCapture(): Promise<never> {
    throw new Error("getCapture not used in archive-site-capture tests");
  }

  async supersede(): Promise<never> {
    throw new Error("supersede not used in archive-site-capture tests");
  }

  async setQuantity(): Promise<never> {
    throw new Error("setQuantity not used in archive-site-capture tests");
  }

  async renameRoom(): Promise<never> {
    throw new Error("renameRoom not used in archive-site-capture tests");
  }

  async archive(): Promise<never> {
    throw new Error("archive not used in archive-site-capture tests");
  }
}

const fixedIds = () => ({ newId: () => "ffffffff-ffff-ffff-ffff-ffffffffffff" });

describe("ArchiveSiteCaptureUseCase", () => {
  it("archives and returns ok when a row was affected", async () => {
    const repo = new FakeMeasurementRepository();
    const useCase = new ArchiveSiteCaptureUseCase(repo, new FixedClock(new Date()), fixedIds());

    const result = await useCase.exec({ captureId: CAPTURE_ID }, ORG);

    expect(isOk(result)).toBe(true);
    expect(repo.archiveSiteCaptureCalls).toEqual([CAPTURE_ID]);
  });

  it("returns not_found (never a quiet success) when zero rows were affected", async () => {
    const repo = new FakeMeasurementRepository();
    repo.archiveSiteCaptureReturns = 0;
    const useCase = new ArchiveSiteCaptureUseCase(repo, new FixedClock(new Date()), fixedIds());

    const result = await useCase.exec({ captureId: CAPTURE_ID }, ORG);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("not_found");
  });
});
