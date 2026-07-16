import { describe, it, expect } from "vitest";
import { asJobId, FixedClock, isOk } from "@mallet/shared/types";
import { ArchiveJobUseCase } from "./archive-job";
import type { JobRepository } from "../domain/job-repository";

const JID = asJobId("11111111-1111-1111-1111-111111111111");

function repoWith(archiveResult: number): JobRepository {
  return {
    nextNumber: async () => "JOB-1",
    save: async () => {},
    insertManual: async () => {},
    archiveByLead: () => Promise.resolve(0),
    archive: async () => archiveResult,
    insertForEstimate: async () => true,
    findById: async () => null,
    findBySourceEstimate: async () => null,
    list: async () => ({ items: [], nextCursor: null }),
    listByLead: async () => ({ items: [], nextCursor: null }),
    // execution stubs — implemented in Task 5
    listExecution: async () => ({ lines: [], addons: [], verifyAnswers: [], photos: [] }),
    listExecutionForJobs: async () => new Map(),
    addLine: async () => {},
    updateLine: async () => 0,
    removeLine: async () => 0,
    replaceLines: async () => {},
    addAddon: async () => {},
    setAddonStatus: async () => 0,
    setAddonInvoiceSkip: async () => 0,
    upsertVerifyAnswer: async () => {},
    removeVerifyAnswer: async () => 0,
    addPhoto: async () => {},
    removePhoto: async () => 0,
    listRecentForCallbackScan: async () => [],
  };
}

describe("ArchiveJobUseCase", () => {
  const clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));

  it("returns ok when a row is archived", async () => {
    const r = await new ArchiveJobUseCase(repoWith(1), clock).exec({ jobId: JID });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.ok).toBe(true);
  });

  it("returns NOT_FOUND when nothing was archived", async () => {
    const r = await new ArchiveJobUseCase(repoWith(0), clock).exec({ jobId: JID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
