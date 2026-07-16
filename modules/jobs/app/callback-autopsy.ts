import type { Result, AppError, Clock, JobId } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { JobRepository } from "../domain/job-repository";
import { computeAutopsy, type AutopsyCluster, type AutopsyPair } from "./compute-autopsy";
import type { VerifyState } from "../domain/job-execution";

export const AUTOPSY_WINDOW_DAYS = 90;

/**
 * Thin orchestrator: fetches confirmed callback pairs within the 90-day window,
 * loads the originals' execution data in one batched query, builds the answers
 * map, and delegates all aggregation to computeAutopsy (pure, Task 2.2).
 *
 * Read-only. No writes. Injected clock — no Date.now().
 */
export class CallbackAutopsyUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(): Promise<Result<AutopsyCluster[], AppError>> {
    const since = new Date(
      this.clock.now().getTime() - AUTOPSY_WINDOW_DAYS * 86400000,
    );

    const rows = await this.repo.listConfirmedCallbacksWithOriginals(since);

    if (rows.length === 0) {
      return ok([]);
    }

    // Deduplicate original ids (Set preserves first-seen order, which is fine here).
    const seenOriginalIds = new Set<string>();
    for (const row of rows) {
      seenOriginalIds.add(String(row.original.id));
    }
    const originalIds = Array.from(seenOriginalIds).map(
      (s) => s as JobId,
    );

    const execById = await this.repo.listExecutionForJobs(originalIds);

    // Build answers: original id → (itemId → VerifyState).
    const answers = new Map<string, Map<string, VerifyState>>();
    for (const origId of seenOriginalIds) {
      const execution = execById.get(origId);
      const verifyAnswers = execution?.verifyAnswers ?? [];
      const itemMap = new Map<string, VerifyState>();
      for (const answer of verifyAnswers) {
        // Access itemId/state via .props — same pattern as toVerifyDTO in job-dto.ts.
        itemMap.set(answer.props.itemId, answer.props.state);
      }
      answers.set(origId, itemMap);
    }

    // Map AutopsyPairRow → AutopsyPair (stringify branded JobIds).
    const autopsyPairs: AutopsyPair[] = rows.map((row) => ({
      callback: {
        id: String(row.callback.id),
        num: row.callback.num,
        svc: row.callback.svc,
      },
      original: {
        id: String(row.original.id),
        num: row.original.num,
        svc: row.original.svc,
        checklist: row.original.checklist,
      },
    }));

    return ok(computeAutopsy(autopsyPairs, answers));
  }
}
