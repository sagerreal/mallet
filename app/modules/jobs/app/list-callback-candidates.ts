import type { Result, AppError, Clock, JobId } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import { detectCallbacks, refTimeOf, CALLBACK_WINDOW_DAYS, type JobLite } from "./detect-callbacks";
import type { JobRepository } from "../domain/job-repository";

export const CALLBACK_SCAN_LOOKBACK_DAYS = 90;

export interface CallbackCandidateView {
  readonly jobId: string;
  readonly jobNum: string;
  readonly original: {
    readonly jobId: string;
    readonly num: string;
    readonly svc: string | null;
    readonly completedAt: Date | null;
  };
}

export class ListCallbackCandidatesUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(): Promise<Result<CallbackCandidateView[], AppError>> {
    const now = this.clock.now();
    const sinceMs = now.getTime() - (CALLBACK_SCAN_LOOKBACK_DAYS + CALLBACK_WINDOW_DAYS) * 86400000;
    const since = new Date(sinceMs);
    const rows = await this.repo.listRecentForCallbackScan(since);
    const lites: JobLite[] = rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      svc: r.svc,
      status: r.status,
      completedAt: r.completedAt,
      scheduledStart: r.scheduledStart,
      createdAt: r.createdAt,
      callbackOf: r.callbackOf,
    }));
    const candidates = detectCallbacks(lites);
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const views: CallbackCandidateView[] = [];
    for (const c of candidates) {
      const jobRow = byId.get(c.jobId as string);
      const origRow = byId.get(c.originalJobId as string);
      if (!jobRow || !origRow) continue;
      if (jobRow.callbackReason !== null) continue;
      views.push({
        jobId: c.jobId as string,
        jobNum: jobRow.num,
        original: {
          jobId: c.originalJobId as string,
          num: origRow.num,
          svc: origRow.svc,
          completedAt: origRow.completedAt,
        },
      });
    }
    // Sort by candidate job's refTime descending (most recent first)
    views.sort((a, b) => {
      const aRow = byId.get(a.jobId)!;
      const bRow = byId.get(b.jobId)!;
      const aTime = refTimeOf({ scheduledStart: aRow.scheduledStart, createdAt: aRow.createdAt }).getTime();
      const bTime = refTimeOf({ scheduledStart: bRow.scheduledStart, createdAt: bRow.createdAt }).getTime();
      return bTime - aTime;
    });
    return ok(views);
  }
}
