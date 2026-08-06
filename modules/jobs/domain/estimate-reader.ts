import type { EstimateId, LeadId } from "@mallet/shared/types";
import type { EstimateStatus } from "@mallet/quoting";

// Narrow read seam over the quoting module, so jobs never import quoting internals — only its
// public Estimate types (via @mallet/quoting) and this port. The DI adapter bridges it to
// quoting's repository.
/** One line of sold work, carried onto the job as its scope. */
export interface EstimateLineSummary {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  /** Does this line take sales tax — carried onto the job line so the bill rebuilt from those
   *  lines charges tax on exactly what the quote did. */
  readonly taxable: boolean;
  readonly position: number;
}

export interface EstimateSummary {
  readonly id: EstimateId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: EstimateStatus;
  /**
   * The scope-visit job this quote priced, or null. When set (and that job is still
   * kind='estimate'), accept CONVERTS it into the sold work in place — the walkthrough and the
   * work stay one job — instead of minting a second job for the same sale.
   */
  readonly jobId: string | null;
  /**
   * The work the customer bought, in order.
   *
   * The job used to receive a title and a total and nothing else, so the SCOPE stayed on the
   * quote: a technician opening the job saw "Repipe — $17,781" with no way to learn there was a
   * drywall patch and a permit in it. Jobber and Housecall Pro both move the lines onto the job at
   * acceptance for exactly this reason, and both treat it as a snapshot — later edits to the quote
   * do not reach through.
   */
  readonly lines: readonly EstimateLineSummary[];
  /** Tax-INCLUSIVE (estimate.ts: total = net + tax). */
  readonly totalCents: number;
  /** The rate applied, and how much of `totalCents` it accounts for. Carried, never re-derived. */
  readonly taxBps: number;
  readonly taxCents: number;
}

export interface EstimateReader {
  read(estimateId: EstimateId): Promise<EstimateSummary | null>;
}
