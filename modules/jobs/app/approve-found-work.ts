import type { JobId, LeadId, OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { JobRepository } from "../domain/job-repository";
import type { ChangeOrderRecorder, ChangeOrderLine } from "../domain/change-order-recorder";
import { JobLine, type JobAddon } from "../domain/job-execution";
import { loadOrThrow, type JobWithExecution } from "./job-execution-use-cases";

export interface ApproveFoundWorkCommand {
  readonly jobId: JobId;
  /** The found-work rows the customer is signing for. Every one of them must move, or none do. */
  readonly addonIds: readonly string[];
  readonly signerName: string;
  readonly signatureSvg: string;
  /** The shop's name for the authorisation sentence — read from the DB by the transport. */
  readonly orgName: string;
  /** The staff member whose device took the approval — the in-person witness. */
  readonly approvedByUserId: string | null;
}

/**
 * The customer signs for found work, and the found work starts billing.
 *
 * THE BUG THIS CLOSES. A technician on site could add found work and mark it approved, and the
 * money went nowhere: approving an add-on flipped a status word and nothing else, and
 * CreateInvoiceFromJobUseCase bills from the job's LINES and has never read add-ons. Work was
 * done, recorded, agreed — and never invoiced.
 *
 * THREE WRITES, ONE TRANSACTION, in this order:
 *
 *   1. the customer's signature, as a signed change-order estimate on the job's lead;
 *   2. the add-on rows flipped proposed → approved, stamped with that estimate's id;
 *   3. the approved add-ons appended to the job's LINES, which is what the invoice copies.
 *
 * Any failure rolls all three back (the caller runs inside the org tx and re-throws). The two
 * states that must never exist are the customer having signed for work the job does not carry,
 * and the job carrying work nobody signed for.
 *
 * WHY THE INVOICE IS NOT CHANGED. Appending to job lines is what wires found work to money —
 * the bill already reads those lines. Teaching the invoice to also read add-ons would bill the
 * same work twice.
 *
 * WHY APPEND AND NOT replaceLines. replaceLines soft-deletes the current rows and inserts the
 * set it is given; re-inserting the existing lines under their own ids would collide with the
 * rows just soft-deleted, and re-inserting them under fresh ids would orphan every invoice line's
 * `source_job_line_id` audit pointer. addLine per approved add-on leaves the signed originals
 * exactly as they are and re-derives the job total in the same statement.
 */
export class ApproveFoundWorkUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly changeOrders: ChangeOrderRecorder,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ApproveFoundWorkCommand, orgId: OrgId): Promise<Result<JobWithExecution, AppError>> {
    if (cmd.addonIds.length === 0) {
      return err(validation("choose at least one item of found work to approve", "addonIds"));
    }
    if (new Set(cmd.addonIds).size !== cmd.addonIds.length) {
      return err(validation("the same item was listed twice", "addonIds"));
    }

    const job = await this.repo.findById(cmd.jobId);
    if (!job) return err(notFound("job not found"));

    const execution = await this.repo.listExecution(cmd.jobId);
    const chosen = selectApprovable(execution.addons, cmd.addonIds);
    if (!isOk(chosen)) return chosen;

    // 1. The signature FIRST, so the add-ons have a document to point at. It is also the write
    //    most likely to be refused (a blank signer, an empty set), and failing before anything
    //    on the job has moved keeps the rollback shallow.
    const recorded = await this.changeOrders.record({
      orgId,
      leadId: job.props.leadId as LeadId,
      jobId: cmd.jobId,
      jobTitle: job.props.title,
      lines: chosen.value.map(toChangeOrderLine),
      signerName: cmd.signerName,
      signatureSvg: cmd.signatureSvg,
      orgName: cmd.orgName,
    });
    if (!isOk(recorded)) return recorded;

    // 2. One conditional UPDATE across the whole set. The port returns the ids it actually moved
    //    precisely so a PARTIAL approval can be refused: the customer signed one document for
    //    these items, and holding two of the three they paid for is a silent under-bill.
    const now = this.clock.now();
    const moved = await this.repo.approveAddons(
      cmd.jobId,
      cmd.addonIds,
      { byUserId: cmd.approvedByUserId, estimateId: recorded.value.estimateId, at: now },
      now,
    );
    const movedIds = new Set(moved);
    if (moved.length !== cmd.addonIds.length || cmd.addonIds.some((id) => !movedIds.has(id))) {
      return err(
        conflict(
          "Some of this found work changed while the customer was signing — reopen the job and approve it again.",
        ),
      );
    }

    // 3. Onto the job's lines, which is where the bill reads from. Appended after everything
    //    already on the job so the signed original scope keeps its order and its positions.
    let position = nextPosition(execution.lines);
    for (const addon of chosen.value) {
      const line = JobLine.create({
        id: this.ids.newId(),
        jobId: cmd.jobId,
        description: addon.props.description,
        quantity: addon.props.quantity,
        rateCents: addon.props.rate,
        costCents: addon.props.cost,
        // `taxable` is deliberately omitted: job_addons has no taxability column of its own, so
        // the line takes job_lines' own default (TRUE) — the same reading every row written
        // before taxability existed already had.
        position,
      });
      if (!isOk(line)) return line;
      await this.repo.addLine(line.value, now);
      position += 1;
    }

    logger.info(
      {
        jobId: cmd.jobId,
        orgId,
        estimateId: recorded.value.estimateId,
        addonCount: chosen.value.length,
        totalCents: recorded.value.totalCents,
      },
      "found_work.approved",
    );
    return loadOrThrow(this.repo, cmd.jobId);
  }
}

/** The approved add-ons, in the job's own add-on order — the order the sheet showed them in. */
function selectApprovable(
  addons: readonly JobAddon[],
  requested: readonly string[],
): Result<JobAddon[], AppError> {
  const wanted = new Set(requested);
  const found = addons.filter((a) => wanted.has(a.props.id));
  if (found.length !== requested.length) {
    return err(notFound("some of that found work is no longer on this job"));
  }
  const settled = found.filter((a) => a.props.status !== "proposed");
  if (settled.length > 0) {
    return err(
      conflict(
        settled.length === found.length
          ? "That found work has already been settled."
          : "Some of that found work has already been settled — reopen the job and approve what is left.",
      ),
    );
  }
  return ok(found);
}

const toChangeOrderLine = (addon: JobAddon): ChangeOrderLine => ({
  description: addon.props.description,
  quantity: addon.props.quantity,
  rateCents: addon.props.rate,
  costCents: addon.props.cost,
});

/** One past the highest position already on the job, so the appended work sorts last. */
const nextPosition = (lines: readonly JobLine[]): number =>
  lines.reduce((max, l) => Math.max(max, l.props.position + 1), 0);
