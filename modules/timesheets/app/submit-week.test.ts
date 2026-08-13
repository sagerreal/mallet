import { describe, it, expect } from "vitest";
import { asOrgId, asUserId, isOk, type UserId } from "@mallet/shared/types";
import { WeekSubmission, type WeekSubmissionProps } from "../domain/week-submission";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { SubmitWeekUseCase, reopenSubmissionForNewHours } from "./submit-week";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const TECH = asUserId("33333333-3333-3333-3333-333333333333");
const WEEK = "2026-08-10"; // Monday

const props = (over: Partial<WeekSubmissionProps> = {}): WeekSubmissionProps => ({
  id: "11111111-1111-1111-1111-111111111111",
  orgId: ORG,
  techUserId: TECH,
  weekStart: WEEK,
  submittedAt: new Date("2026-08-14T20:00:00Z"),
  reopenedAt: null,
  reopenReason: null,
  createdAt: new Date("2026-08-14T20:00:00Z"),
  updatedAt: new Date("2026-08-14T20:00:00Z"),
  ...over,
});

const sub = (over: Partial<WeekSubmissionProps> = {}): WeekSubmission => {
  const r = WeekSubmission.create(props(over));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

/** In-memory repository — one row per (tech, week), like the unique index guarantees. */
class FakeSubmissions implements WeekSubmissionRepository {
  rows = new Map<string, WeekSubmission>();
  private key = (tech: string, week: string) => `${tech}:${week}`;

  async findFor(techUserId: UserId, weekStart: string): Promise<WeekSubmission | null> {
    return this.rows.get(this.key(techUserId, weekStart)) ?? null;
  }
  async claim(input: {
    id: string;
    orgId: string;
    techUserId: string;
    weekStart: string;
    submittedAt: Date;
  }): Promise<{ submission: WeekSubmission; created: boolean }> {
    const k = this.key(input.techUserId, input.weekStart);
    const existing = this.rows.get(k);
    if (existing) return { submission: existing, created: false };
    const created = sub({
      id: input.id,
      weekStart: input.weekStart,
      submittedAt: input.submittedAt,
    });
    this.rows.set(k, created);
    return { submission: created, created: true };
  }
  async save(submission: WeekSubmission): Promise<void> {
    this.rows.set(this.key(submission.props.techUserId, submission.props.weekStart), submission);
  }
}

const entriesWithOpen = (open: boolean | string): TimeEntryRepository =>
  ({
    // The open row's WORK DATE matters now: a day still on the clock blocks the week it belongs to
    // and no other. `open` may be a boolean (inside the week under test) or an explicit date.
    findOpenForTech: async () =>
      open === false || open === null
        ? null
        : ({ props: { workDate: open === true ? "2026-08-12" : open } } as never),
  }) as unknown as TimeEntryRepository;

const clock = { now: () => new Date("2026-08-15T09:00:00Z") };
const ids = { newId: () => "44444444-4444-4444-4444-444444444444" };

const useCase = (repo: FakeSubmissions, open: boolean | string = false) =>
  new SubmitWeekUseCase(repo, entriesWithOpen(open), clock, ids);

describe("SubmitWeekUseCase", () => {
  it("creates the attestation on first submit", async () => {
    const repo = new FakeSubmissions();
    const r = await useCase(repo).exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    expect(isOk(r)).toBe(true);
    expect(repo.rows.size).toBe(1);
  });

  it("refuses while the clock is running — a mid-stretch week cannot be attested", async () => {
    const repo = new FakeSubmissions();
    const r = await useCase(repo, true).exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("End the day");
  });

  it("ALLOWS submitting a finished week while today is still on the clock", async () => {
    // The ordinary Monday morning: last week is done, he is already working. A technician has at
    // most one open row — the day he is standing in — so a global "is anything running" check
    // refused this every time, naming a week that had nothing open in it.
    const repo = new FakeSubmissions();
    const r = await useCase(repo, "2026-08-17").exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    expect(isOk(r), "a running day in a LATER week blocked an earlier week's attestation").toBe(true);
  });

  it("is idempotent: a replayed submit returns the standing attestation unchanged", async () => {
    const repo = new FakeSubmissions();
    await useCase(repo).exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    const again = await useCase(repo).exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    expect(isOk(again)).toBe(true);
    if (isOk(again)) expect(again.value.props.submittedAt.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    expect(repo.rows.size).toBe(1);
  });

  it("re-signs a reopened week on the same row", async () => {
    const repo = new FakeSubmissions();
    repo.rows.set(`${TECH}:${WEEK}`, sub().reopen("late clock-in", new Date("2026-08-15T07:00:00Z")));
    const r = await useCase(repo).exec({ techUserId: TECH, weekStart: WEEK }, ORG);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.isActive()).toBe(true);
      expect(r.value.props.reopenReason).toBeNull();
    }
    expect(repo.rows.size).toBe(1);
  });
});

describe("reopenSubmissionForNewHours", () => {
  const args = {
    orgId: ORG,
    techUserId: TECH,
    weekStart: WEEK,
    reason: "hours landed after submit",
    now: new Date("2026-08-15T10:00:00Z"),
  };

  it("reopens a standing attestation", async () => {
    const repo = new FakeSubmissions();
    repo.rows.set(`${TECH}:${WEEK}`, sub());
    await reopenSubmissionForNewHours(repo, args);
    const after = await repo.findFor(TECH, WEEK);
    expect(after?.isActive()).toBe(false);
    expect(after?.props.reopenReason).toBe("hours landed after submit");
  });

  it("does nothing when there is no submission, or it is already reopened", async () => {
    const empty = new FakeSubmissions();
    await reopenSubmissionForNewHours(empty, args); // must not throw
    expect(empty.rows.size).toBe(0);

    const reopened = new FakeSubmissions();
    const already = sub().reopen("first reopen", new Date("2026-08-15T08:00:00Z"));
    reopened.rows.set(`${TECH}:${WEEK}`, already);
    await reopenSubmissionForNewHours(reopened, args);
    const after = await reopened.findFor(TECH, WEEK);
    expect(after?.props.reopenReason).toBe("first reopen");
  });
});
