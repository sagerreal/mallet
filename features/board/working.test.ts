/**
 * features/board/working.test.ts
 * The scoped row must carry its walkthrough JOB — that id is what "quote it ›" hands the
 * composer (&job=), and the composer's draft points the quote back at the job so accepting it
 * CONVERTS the walkthrough into the sold work instead of minting a duplicate.
 */
import { describe, it, expect } from "vitest";
import { deriveGetting } from "./working";
import type { Lead, Estimate, Job } from "@/lib/store/types";

const lead = {
  id: "lead-1",
  name: "Dana Fox",
  job: "Repipe",
  stage: "Contacted",
  age: 1,
  archived: false,
} as unknown as Lead;

const scopeJob = {
  id: "job-9",
  leadId: "lead-1",
  kind: "estimate",
  archived: false,
  visits: [{ id: "v1", status: "done", date: "2026-07-01", scopeNotes: "40ft copper, drywall patch" }],
} as unknown as Job;

describe("deriveGetting — scoped rows carry their walkthrough job", () => {
  it("threads the scope-visit JOB id onto the scoped row", () => {
    const rows = deriveGetting([lead], [], [scopeJob]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("scoped");
    expect(rows[0]!.verb).toBe("quote it ›");
    expect(rows[0]!.scopeVisitJobId).toBe("job-9");
  });

  it("shop rows (paper in the composer) carry no job id", () => {
    const draft = {
      id: "est-1",
      leadId: "lead-1",
      status: "draft",
      archived: false,
      trash: false,
    } as unknown as Estimate;
    const rows = deriveGetting([lead], [draft], []);
    expect(rows[0]!.kind).toBe("shop");
    expect(rows[0]!.scopeVisitJobId).toBeNull();
  });

  it("walkthrough-booked rows (not yet scoped) carry no job id", () => {
    const pendingJob = {
      id: "job-10",
      leadId: "lead-1",
      kind: "estimate",
      archived: false,
      visits: [{ id: "v2", status: "scheduled", date: "2099-01-05", scopeNotes: undefined }],
    } as unknown as Job;
    const rows = deriveGetting([lead], [], [pendingJob]);
    expect(rows[0]!.kind).toBe("visit");
    expect(rows[0]!.scopeVisitJobId).toBeNull();
  });
});
