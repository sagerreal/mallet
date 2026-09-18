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
  /** Does this line take sales tax. The bill copies it onto the invoice line and charges the
   *  job's taxBps on the taxable lines only. */
  readonly taxable: boolean;
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
  /** Tax-INCLUSIVE and discount-APPLIED, snapshotted from the accepted estimate. */
  readonly totalCents: number;
  /** The rate applied, and how much of `totalCents` it accounts for. Carried, never re-derived. */
  readonly taxBps: number;
  readonly taxCents: number;
  /**
   * The discount rate agreed on the quote, in bps. 0 on a job that was never discounted.
   *
   * The bill CANNOT be correct without it. `lines` are pre-tax AND pre-discount, `totalCents` is
   * both applied, and the invoice prefers the lines because the snapshot goes stale on the on-site
   * sign path — so a discounted sale billed from its lines charged the customer the full,
   * undiscounted sum.
   */
  readonly discBps: number;
}

export interface JobReader {
  read(jobId: JobId): Promise<JobSummary | null>;
}
