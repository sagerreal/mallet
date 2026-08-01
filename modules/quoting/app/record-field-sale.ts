import { randomBytes } from "node:crypto";
import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateId, asEstimateLineId, money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Estimate, EstimateLine } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

// Same construction as draft-estimate's token: unguessable, URL-safe, set once at birth.
const generatePublicToken = (): string => randomBytes(32).toString("hex");

export interface FieldSaleLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
}

export interface RecordFieldSaleCommand {
  readonly orgId: OrgId;
  /** The job's lead — the customer the quote belongs to. Caller (the field router) verifies the
   *  lead actually exists and fails the whole sign if not; this use case trusts the id. */
  readonly leadId: LeadId;
  /** For the log line only — the estimate↔job link is job.source_estimate_id, written by the caller. */
  readonly jobId: string;
  readonly jobTitle: string | null;
  /** The job's current source estimate (job.source_estimate_id), if any. Decides create vs update. */
  readonly existingEstimateId: string | null;
  readonly lines: readonly FieldSaleLineInput[];
  readonly signerName: string;
  readonly signatureSvg: string;
  readonly orgName: string;
}

/** What happened, so the caller knows whether to link job.source_estimate_id. */
export type FieldSaleOutcome =
  | { readonly kind: "created"; readonly estimate: Estimate }
  | { readonly kind: "updated"; readonly estimate: Estimate }
  /** The job was sold from an OFFICE quote — that quote is already the record of the sale, and
   *  its signed evidence is frozen. Nothing is written; the on-site re-price lives on the job. */
  | { readonly kind: "kept_office_estimate"; readonly estimate: Estimate };

/**
 * Make a quote sold in the field a REAL quote.
 *
 * v1.field.signQuote used to write lines + a signature onto the JOB and nothing else — the sale
 * never reached the estimates table, so it never appeared on the quotes rail, never counted as
 * won revenue, and taught the learning estimator nothing. This records the same signed sale as an
 * accepted Estimate (origin 'field') on the job's lead, in the SAME transaction as the job write.
 *
 * Idempotent per job: a re-sign UPDATES the job's existing field estimate (whatever was signed
 * last is the quote) rather than minting a duplicate accepted quote for the same work.
 */
export class RecordFieldSaleUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RecordFieldSaleCommand): Promise<Result<FieldSaleOutcome, AppError>> {
    const now = this.clock.now();

    const built: EstimateLine[] = [];
    for (let i = 0; i < cmd.lines.length; i += 1) {
      const input = cmd.lines[i];
      if (!input) continue;
      const line = EstimateLine.create({
        id: asEstimateLineId(this.ids.newId()),
        description: input.description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        isOptional: false, // on-site lines are all sold — the customer signed the whole set
        needsPhoto: false,
        position: i,
        tier: null,
        materialId: null,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }

    const signature = {
      signerName: cmd.signerName,
      signatureSvg: cmd.signatureSvg,
      // Null on purpose (matches the job-side record): the tablet's IP/UA belong to the TECH's
      // device, not the signer, and would be decoration pretending to be evidence.
      signerIp: null,
      signerUserAgent: null,
    };

    if (cmd.existingEstimateId) {
      const existing = await this.repo.findById(asEstimateId(cmd.existingEstimateId));
      if (!existing) {
        // The job points at an estimate that is gone — corrupt linkage. Fail the sign loudly
        // rather than quietly minting a second quote for the same job.
        return err(notFound(`the job's source estimate ${cmd.existingEstimateId} no longer exists`));
      }
      if (existing.origin() === "office") {
        // The sale is already a real quote (the office one that created this job). Its signed
        // document is frozen; the revised on-site price is recorded on the job itself.
        logger.info(
          { jobId: cmd.jobId, estimateId: existing.props.id, orgId: cmd.orgId },
          "field_sale.kept_office_estimate",
        );
        return ok({ kind: "kept_office_estimate", estimate: existing });
      }
      const resigned = existing.resignOnSite(built, signature, cmd.orgName, now);
      if (!isOk(resigned)) return resigned;
      await this.repo.save(resigned.value);
      logger.info(
        { jobId: cmd.jobId, estimateId: resigned.value.props.id, orgId: cmd.orgId, totalCents: resigned.value.total() },
        "field_sale.estimate_resigned",
      );
      return ok({ kind: "updated", estimate: resigned.value });
    }

    // Number allocation after line validation, so a rejected sign doesn't burn a number.
    const num = await this.repo.nextNumber();
    const created = Estimate.sellOnSite({
      id: asEstimateId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      title: cmd.jobTitle,
      lines: built,
      publicToken: generatePublicToken(),
      signature,
      orgName: cmd.orgName,
      now,
    });
    if (!isOk(created)) return created;

    await this.repo.save(created.value);
    // Same announcement the office accept makes — downstream listeners must not care where the
    // yes happened. (The event currently has no handler; the outbox records it for audit.)
    await this.bus.emit({
      name: "estimate.accepted",
      orgId: cmd.orgId,
      payload: {
        estimateId: created.value.props.id,
        leadId: cmd.leadId,
        totalCents: created.value.total(),
        depositDueCents: created.value.depositDue(),
      },
      occurredAt: now,
    });
    logger.info(
      { jobId: cmd.jobId, estimateId: created.value.props.id, orgId: cmd.orgId, totalCents: created.value.total() },
      "field_sale.estimate_created",
    );
    return ok({ kind: "created", estimate: created.value });
  }
}
