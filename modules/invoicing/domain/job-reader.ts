import type { JobId, LeadId, EstimateId } from "@mallet/shared/types";
import type { JobStatus } from "@mallet/jobs";

// Narrow read seam over the jobs module, so invoicing never imports jobs internals — only its
// public types (via @mallet/jobs) and this port. Mirrors jobs/domain/estimate-reader.ts.

/** One billable line captured on the job, as the invoice needs to see it. */
export interface JobLineSummary {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly position: number;
}

export interface JobSummary {
  readonly id: JobId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: JobStatus;
  /** 'estimate' marks a scoping visit whose deliverable is a quote, not a bill. Source of truth
   *  since 0133 — svc is only the trade label and no longer carries this. */
  readonly kind: string;
  readonly num: string;
  /** The accepted estimate this job came from, when there is one — the deposit lives there. */
  readonly sourceEstimateId: EstimateId | null;
  /**
   * The job's live billable lines. On-site signed prices live in `job_lines` — `totalCents` is a
   * creation-time snapshot the sign path never updates — so the invoice must read the lines
   * themselves: they are both the priced-ness signal and the content of the bill.
   */
  readonly lines: readonly JobLineSummary[];
  /** Tax-INCLUSIVE, snapshotted from the accepted estimate. */
  readonly totalCents: number;
  /** The rate applied, and how much of `totalCents` it accounts for. Carried, never re-derived. */
  readonly taxBps: number;
  readonly taxCents: number;
}

export interface JobReader {
  read(jobId: JobId): Promise<JobSummary | null>;
}
