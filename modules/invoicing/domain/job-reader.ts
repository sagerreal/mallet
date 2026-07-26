import type { JobId, LeadId } from "@mallet/shared/types";
import type { JobStatus } from "@mallet/jobs";

// Narrow read seam over the jobs module, so invoicing never imports jobs internals — only its
// public types (via @mallet/jobs) and this port. Mirrors jobs/domain/estimate-reader.ts.
export interface JobSummary {
  readonly id: JobId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: JobStatus;
  /** Tax-INCLUSIVE, snapshotted from the accepted estimate. */
  readonly totalCents: number;
  /** The rate applied, and how much of `totalCents` it accounts for. Carried, never re-derived. */
  readonly taxBps: number;
  readonly taxCents: number;
}

export interface JobReader {
  read(jobId: JobId): Promise<JobSummary | null>;
}
