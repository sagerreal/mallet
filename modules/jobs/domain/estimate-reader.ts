import type { EstimateId, LeadId } from "@mallet/shared/types";
import type { EstimateStatus } from "@mallet/quoting";

// Narrow read seam over the quoting module, so jobs never import quoting internals — only its
// public Estimate types (via @mallet/quoting) and this port. The DI adapter bridges it to
// quoting's repository.
export interface EstimateSummary {
  readonly id: EstimateId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: EstimateStatus;
  /** Tax-INCLUSIVE (estimate.ts: total = net + tax). */
  readonly totalCents: number;
  /** The rate applied, and how much of `totalCents` it accounts for. Carried, never re-derived. */
  readonly taxBps: number;
  readonly taxCents: number;
}

export interface EstimateReader {
  read(estimateId: EstimateId): Promise<EstimateSummary | null>;
}
