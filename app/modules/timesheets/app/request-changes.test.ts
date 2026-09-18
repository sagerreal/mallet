import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asUserId, type OrgId, type UserId } from "@mallet/shared/types";
import { WeekSubmission } from "../domain/week-submission";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";
import { RequestChangesUseCase } from "./request-changes";

const ORG = asOrgId("11111111-1111-1111-1111-111111111111");
const TECH = "22222222-2222-2222-2222-222222222222";
const WEEK = "2026-08-10";
const NOW = new Date("2026-08-14T17:00:00.000Z");

const submission = (over: { reopenedAt?: Date | null } = {}): WeekSubmission => {
  const r = WeekSubmission.create({
    id: "33333333-3333-3333-3333-333333333333",
    orgId: ORG,
    techUserId: asUserId(TECH),
    weekStart: WEEK,
    submittedAt: new Date("2026-08-13T18:00:00.000Z"),
    reopenedAt: over.reopenedAt ?? null,
    reopenReason: over.reopenedAt ? "earlier reason" : null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  if (!r.ok) throw new Error("fixture");
  return r.value;
};

class FakeRepo implements WeekSubmissionRepository {
  row: WeekSubmission | null = null;
  saved: WeekSubmission | null = null;
  async findFor(_t: UserId, _w: string) {
    return this.row;
  }
  async findForWeek(_w: string) {
    return this.row ? [this.row] : [];
  }
  async claim(): Promise<never> {
    throw new Error("not used");
  }
  async save(s: WeekSubmission) {
    this.saved = s;
  }
}

let repo: FakeRepo;
const clock = { now: () => NOW };
const uc = () => new RequestChangesUseCase(repo, clock);

beforeEach(() => {
  repo = new FakeRepo();
});

describe("RequestChangesUseCase", () => {
  it("hands a submitted week back, recording the reason", async () => {
    repo.row = submission();
    const res = await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "Wednesday never clocked out" }, ORG);
    expect(res.ok).toBe(true);
    expect(repo.saved?.props.reopenedAt).toEqual(NOW);
    expect(repo.saved?.props.reopenReason).toBe("Wednesday never clocked out");
  });

  it("REFUSES a week that was never submitted — there is no sign-off to retract", async () => {
    // Reopening is the act of retracting an attestation. Inventing one would write a submittedAt
    // the technician never made.
    repo.row = null;
    const res = await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "fix Wednesday" }, ORG);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("conflict");
    expect(repo.saved).toBeNull();
  });

  it("is a no-op that SUCCEEDS when the week is already back with him", async () => {
    // The caller wanted the week in his hands and it is. Failing here would make a second press in
    // a batch read as an error.
    repo.row = submission({ reopenedAt: new Date("2026-08-14T09:00:00.000Z") });
    const res = await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "again" }, ORG);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.reopened).toBe(false);
    expect(repo.saved).toBeNull(); // the earlier reason is not overwritten
  });

  it("requires a reason — he cannot guess which day is wrong", async () => {
    repo.row = submission();
    const res = await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "   " }, ORG);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("validation");
  });

  it("refuses a reason too long to sit on his screen", async () => {
    repo.row = submission();
    const res = await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "x".repeat(301) }, ORG);
    expect(res.ok).toBe(false);
  });

  it("trims the reason rather than storing the whitespace", async () => {
    repo.row = submission();
    await uc().exec({ techUserId: TECH, weekStart: WEEK, reason: "  Friday looks short  " }, ORG);
    expect(repo.saved?.props.reopenReason).toBe("Friday looks short");
  });
});
