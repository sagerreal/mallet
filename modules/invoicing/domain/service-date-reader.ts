import type { JobId } from "@mallet/shared/types";

/**
 * WHEN the work was actually done — the one fact an invoice states that the invoice row itself
 * does not know.
 *
 * A narrow read seam over the jobs module (same shape as JobReader and ConnectTargetReader) so
 * invoicing never touches jobs internals. It answers ONE question and it is allowed to answer
 * "I don't know": a bill with no source job, or a job whose visits were never completed, has no
 * service date, and the document omits the row rather than inventing one.
 *
 * NEVER FALL BACK TO THE INVOICE DATE. They answer different questions — when the work happened
 * vs when the bill was raised — and a customer may hand this page to an insurer, a landlord or a
 * warranty desk. Printing the invoice date under a "Service" label is stating something untrue on
 * a document someone else relies on.
 */
export interface ServiceDateReader {
  forJob(jobId: JobId): Promise<Date | null>;
}

/** The shape of a visit this rule needs — deliberately structural, so no jobs type crosses over. */
export interface CompletableVisit {
  readonly status: string;
  readonly completedAt: Date | null;
}

/**
 * THE rule: the service date is the LATEST completed visit's own completion stamp.
 *
 * Latest, not earliest: a two-visit job (diagnose Tuesday, install Thursday) is billed for work
 * that finished Thursday, and that is the date a warranty or a workmanship period runs from.
 *
 * A visit's `completed_at` is the stamp the technician's tap wrote, NOT the job's `completed_at`
 * (which the office can set days later when it closes the paperwork) and NOT the visit's scheduled
 * date (which is the plan, and a job moved twice has three of them). Only `complete` visits count;
 * a canceled or still-pending one records no work.
 *
 * A completed visit with a null stamp — the row exists but nobody's tap wrote a time — contributes
 * nothing. Absent means unknown, and unknown must not be back-filled.
 */
export const serviceDateFromVisits = (visits: readonly CompletableVisit[]): Date | null => {
  const stamps = visits
    .filter((v) => v.status === "complete")
    .map((v) => v.completedAt)
    .filter((d): d is Date => d !== null);
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest));
};
