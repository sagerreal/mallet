import type { OrgId, LeadId, Result, AppError } from "@mallet/shared/types";

/**
 * Narrow WRITE seam over the quoting module: record the customer's signature on found work as a
 * signed change-order document, without the jobs module knowing what an Estimate is.
 *
 * Mirrors EstimateReader (the read seam) — jobs owns the port, the DI adapter in jobs/infra
 * bridges it to quoting's use case through @mallet/quoting's public barrel.
 *
 * WHY A PORT AND NOT A DIRECT CALL. The approval use case is where the three writes are ordered
 * and rolled back together, so it is the piece that most needs to be testable without a database
 * or a quoting aggregate. A fake recorder makes "the add-ons did not all move, so nothing is
 * written" a unit test instead of an integration test.
 */

/** One priced item of found work, as it will appear on the document the customer signs. */
export interface ChangeOrderLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
}

export interface ChangeOrderRequest {
  readonly orgId: OrgId;
  /** The customer the addendum belongs to — the job's lead. */
  readonly leadId: LeadId;
  /** The RUNNING job this addendum adds work to. */
  readonly jobId: string;
  readonly jobTitle: string | null;
  readonly lines: readonly ChangeOrderLine[];
  readonly signerName: string;
  readonly signatureSvg: string;
  /** The shop's name for the authorisation sentence — read from the DB by the transport, never
   *  supplied by the tablet (a client-authored counterparty on a signed document is a hole). */
  readonly orgName: string;
}

/** What the approval stamps onto the add-on rows: which document they belong to, and its total. */
export interface RecordedChangeOrder {
  readonly estimateId: string;
  readonly totalCents: number;
}

export interface ChangeOrderRecorder {
  record(request: ChangeOrderRequest): Promise<Result<RecordedChangeOrder, AppError>>;
}
