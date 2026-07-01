import type { JobId, LeadId } from "@mallet/shared/types";
import type { JobStatus } from "@mallet/jobs";

// Narrow read seam over the jobs module, so invoicing never imports jobs internals — only its
// public types (via @mallet/jobs) and this port. Mirrors jobs/domain/estimate-reader.ts.
export interface JobSummary {
  readonly id: JobId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: JobStatus;
  readonly totalCents: number;
}

export interface JobReader {
  read(jobId: JobId): Promise<JobSummary | null>;
}
