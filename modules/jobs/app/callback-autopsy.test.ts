import { describe, it, expect } from "vitest";
import { asJobId, FixedClock, isOk } from "@mallet/shared/types";
import type { JobRepository, AutopsyPairRow, CallbackScanRow } from "../domain/job-repository";
import type { JobExecution } from "../domain/job-repository";
import { JobVerifyAnswer } from "../domain/job-execution";
import { CallbackAutopsyUseCase, AUTOPSY_WINDOW_DAYS } from "./callback-autopsy";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JID_CB1 = asJobId("cb111111-1111-1111-1111-111111111111");
const JID_CB2 = asJobId("cb222222-2222-2222-2222-222222222222");
const JID_ORIG1 = asJobId("or111111-1111-1111-1111-111111111111");
const JID_ORIG2 = asJobId("or222222-2222-2222-2222-222222222222");

// Fixed clock anchored at a known instant.
const NOW = new Date("2026-07-15T12:00:00Z");
const EXPECTED_SINCE = new Date(NOW.getTime() - AUTOPSY_WINDOW_DAYS * 86400000);

// A minimal checklist with two required items.
const CHECKLIST = {
  name: "Plumbing Pre-Leave",
  items: [
    { id: "step-a", text: "Tested pressure", type: "check" as const, required: true },
    { id: "step-b", text: "Cleared drain", type: "check" as const, required: true },
  ],
};

// Build two pairs sharing one service — both callback on ORIG1 and ORIG2 respectively.
// Both originals have the same checklist, so the cluster has 2 answered originals.
function makePairs(): AutopsyPairRow[] {
  return [
    {
      callback: { id: JID_CB1, num: "JOB-201", svc: "Drain Cleaning", completedAt: null },
      original: {
        id: JID_ORIG1,
        num: "JOB-101",
        svc: "Drain Cleaning",
        completedAt: new Date("2026-05-01T00:00:00Z"),
        checklist: CHECKLIST,
      },
    },
    {
      callback: { id: JID_CB2, num: "JOB-202", svc: "Drain Cleaning", completedAt: null },
      original: {
        id: JID_ORIG2,
        num: "JOB-102",
        svc: "Drain Cleaning",
        completedAt: new Date("2026-05-15T00:00:00Z"),
        checklist: CHECKLIST,
      },
    },
  ];
}

/**
 * Build a real JobVerifyAnswer via domain constructor — exercises the actual
 * itemId/state extraction path used by the use-case (answer.props.itemId etc.).
 */
function makeAnswer(jobId: ReturnType<typeof asJobId>, itemId: string, state: "pass" | "override"): JobVerifyAnswer {
  const result = JobVerifyAnswer.create({
    jobId,
    itemId,
    state,
    via: null,
    reason: state === "override" ? "not applicable" : null,
  });
  if (!result.ok) throw new Error(`setup: ${result.error.message}`);
  return result.value;
}

// ── Fake repo ─────────────────────────────────────────────────────────────────

class FakeRepo implements JobRepository {
  /** All `since` values passed to listConfirmedCallbacksWithOriginals. */
  readonly sinceArgs: Date[] = [];
  /** All jobId arrays passed to listExecutionForJobs. */
  readonly executionIdArgs: (readonly ReturnType<typeof asJobId>[])[] = [];

  constructor(
    private readonly pairs: AutopsyPairRow[],
    private readonly executionMap: Map<string, JobExecution>,
  ) {}

  async listConfirmedCallbacksWithOriginals(since: Date): Promise<AutopsyPairRow[]> {
    this.sinceArgs.push(since);
    return this.pairs;
  }

  async listExecutionForJobs(jobIds: readonly ReturnType<typeof asJobId>[]): Promise<Map<string, JobExecution>> {
    this.executionIdArgs.push(jobIds);
    return this.executionMap;
  }

  // ── stubs for unused methods ───────────────────────────────────────────────
  async nextNumber() { return "JOB-1"; }
  async save() {}
  async insertManual() {}
  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> { return 1; }
  async insertForEstimate(): Promise<boolean> { return true; }
  async findById() { return null; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listRecentForCallbackScan(): Promise<CallbackScanRow[]> { return []; }
  async addLine() {}
  async updateLine(): Promise<number> { return 0; }
  async removeLine(): Promise<number> { return 0; }
  async replaceLines() {}
  async saveOnSiteSignature(): Promise<void> {}
  async count(): Promise<number> { return 0; }
  async viewCounts(): Promise<{ counts: Record<string, number>; todayCents: number }> { return { counts: {}, todayCents: 0 } as never; }
  async addAddon() {}
  async setAddonStatus(): Promise<number> { return 0; }
  async setAddonInvoiceSkip(): Promise<number> { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer(): Promise<number> { return 0; }
  async addPhoto() {}
  async removePhoto(): Promise<number> { return 0; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CallbackAutopsyUseCase", () => {
  it("returns ok([]) and does NOT call listExecutionForJobs when repo returns no pairs", async () => {
    const repo = new FakeRepo([], new Map());
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    const result = await uc.exec();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual([]);
    expect(repo.executionIdArgs).toHaveLength(0);
  });

  it("computes since as now − 90 days and passes it to listConfirmedCallbacksWithOriginals", async () => {
    const repo = new FakeRepo([], new Map());
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    await uc.exec();

    expect(repo.sinceArgs).toHaveLength(1);
    expect(repo.sinceArgs[0]!.getTime()).toBe(EXPECTED_SINCE.getTime());
  });

  it("calls listExecutionForJobs with DISTINCT original ids (two pairs, two distinct originals → two ids)", async () => {
    const repo = new FakeRepo(makePairs(), new Map());
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    await uc.exec();

    expect(repo.executionIdArgs).toHaveLength(1);
    const passedIds = Array.from(repo.executionIdArgs[0]!).map(String);
    // Both originals are distinct — both should be requested.
    expect(new Set(passedIds).size).toBe(2);
    expect(passedIds).toContain(JID_ORIG1 as string);
    expect(passedIds).toContain(JID_ORIG2 as string);
  });

  it("deduplicates original ids when two callbacks share the same original", async () => {
    const sharedOrigId = JID_ORIG1;
    const pairsWithSharedOrig: AutopsyPairRow[] = [
      {
        callback: { id: JID_CB1, num: "JOB-201", svc: "Drain Cleaning", completedAt: null },
        original: {
          id: sharedOrigId,
          num: "JOB-101",
          svc: "Drain Cleaning",
          completedAt: new Date("2026-05-01T00:00:00Z"),
          checklist: CHECKLIST,
        },
      },
      {
        callback: { id: JID_CB2, num: "JOB-202", svc: "Drain Cleaning", completedAt: null },
        original: {
          id: sharedOrigId, // same original
          num: "JOB-101",
          svc: "Drain Cleaning",
          completedAt: new Date("2026-05-01T00:00:00Z"),
          checklist: CHECKLIST,
        },
      },
    ];

    const repo = new FakeRepo(pairsWithSharedOrig, new Map());
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    await uc.exec();

    expect(repo.executionIdArgs).toHaveLength(1);
    const passedIds = Array.from(repo.executionIdArgs[0]!).map(String);
    // Despite two pairs, only ONE distinct original id should be passed.
    expect(passedIds).toHaveLength(1);
    expect(passedIds[0]).toBe(sharedOrigId as string);
  });

  it("returns cluster with correct topMiss when originals have a commonly-skipped step", async () => {
    const pairs = makePairs();

    // ORIG1: passed step-a, missed step-b (absent from answers = missed).
    const orig1Answers: JobVerifyAnswer[] = [
      makeAnswer(JID_ORIG1, "step-a", "pass"),
      // step-b absent → missed
    ];

    // ORIG2: passed step-a, overrode step-b (override = missed by miss-rule).
    const orig2Answers: JobVerifyAnswer[] = [
      makeAnswer(JID_ORIG2, "step-a", "pass"),
      makeAnswer(JID_ORIG2, "step-b", "override"),
    ];

    const execMap = new Map<string, JobExecution>([
      [JID_ORIG1 as string, { lines: [], addons: [], verifyAnswers: orig1Answers, photos: [] }],
      [JID_ORIG2 as string, { lines: [], addons: [], verifyAnswers: orig2Answers, photos: [] }],
    ]);

    const repo = new FakeRepo(pairs, execMap);
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    const result = await uc.exec();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value).toHaveLength(1);
    const cluster = result.value[0]!;

    expect(cluster.service).toBe("Drain Cleaning");
    expect(cluster.callbackCount).toBe(2);
    expect(cluster.answeredOriginals).toBe(2);
    expect(cluster.originalNums).toContain("JOB-101");
    expect(cluster.originalNums).toContain("JOB-102");

    // step-b missed by both originals → topMiss
    expect(cluster.topMiss).not.toBeNull();
    expect(cluster.topMiss!.itemText).toBe("Cleared drain");
    expect(cluster.topMiss!.checklistName).toBe("Plumbing Pre-Leave");
    expect(cluster.topMiss!.missCount).toBe(2);
    expect(cluster.topMiss!.ofAnswered).toBe(2);
    expect(cluster.topMiss!.alreadyRequired).toBe(true);
  });

  it("uses real JobVerifyAnswer.props to extract itemId and state (domain object access pattern)", async () => {
    // This test explicitly verifies that the use-case reads answer.props.itemId / answer.props.state
    // rather than accessing raw fields — exercises the domain object boundary.
    const pairs = makePairs().slice(0, 1); // single pair for clarity

    const answer = makeAnswer(JID_ORIG1, "step-a", "pass");
    // Confirm the props getter works as expected (domain contract check).
    expect(answer.props.itemId).toBe("step-a");
    expect(answer.props.state).toBe("pass");

    const execMap = new Map<string, JobExecution>([
      [JID_ORIG1 as string, { lines: [], addons: [], verifyAnswers: [answer], photos: [] }],
    ]);

    const repo = new FakeRepo(pairs, execMap);
    const clock = new FixedClock(NOW);
    const uc = new CallbackAutopsyUseCase(repo, clock);

    const result = await uc.exec();

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // step-a was passed; step-b was missed → topMiss should be step-b
    expect(result.value[0]!.topMiss?.itemText).toBe("Cleared drain");
  });
});
