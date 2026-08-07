import { randomBytes } from "node:crypto";
import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateId, asEstimateLineId, money, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { Estimate, EstimateLine } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

// Same construction as draft-estimate's and record-field-sale's token: unguessable, URL-safe,
// set once at birth. The customer gets a real, linkable copy of what they signed.
const generatePublicToken = (): string => randomBytes(32).toString("hex");

export interface ChangeOrderLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
}

export interface RecordChangeOrderCommand {
  readonly orgId: OrgId;
  /** The job's lead — the customer the addendum belongs to. The caller verifies the lead exists
   *  and fails the whole approval if not; this use case trusts the id. */
  readonly leadId: LeadId;
  /** The RUNNING job this addendum adds work to. Written to estimates.change_order_for_job_id. */
  readonly jobId: string;
  /** The job's title, so the addendum names the work it belongs to. */
  readonly jobTitle: string | null;
  readonly lines: readonly ChangeOrderLineInput[];
  readonly signerName: string;
  readonly signatureSvg: string;
  /** Read from the DB by the caller — the shop's name in the sentence the customer signs. */
  readonly orgName: string;
}

/** What a customer-facing addendum is called. Matches the app's own word for it ("Found work"). */
const addendumTitle = (jobTitle: string | null): string =>
  jobTitle && jobTitle.trim().length > 0 ? `Found work — ${jobTitle.trim()}` : "Found work";

/**
 * Record the customer's signature on FOUND WORK as a signed change-order estimate.
 *
 * WHY AN ESTIMATE AND NOT A COLUMN ON THE ADD-ON. The sentence the customer already signed on the
 * original job says "Work beyond what is listed above is not included and needs my approval before
 * it is done." Approving found work therefore has to produce the same kind of artefact the original
 * approval did: a priced document, a name, a mark and a frozen snapshot. Recording it as an
 * estimate with `changeOrderForJobId` set is what makes the invoicing module's overage check work —
 * `withChangeOrders` folds every SIGNED change order into the job's authorised amount and excludes
 * unsigned ones, so signed extra work stops looking like unauthorised billing.
 *
 * NOT idempotent per job, unlike RecordFieldSaleUseCase. That one re-signs the single quote behind
 * a job (one job, one field quote, whatever was signed last). A job can accumulate MANY addenda —
 * three separate trips back to the van, three separate approvals — and collapsing them would
 * destroy the record of what was agreed when. Each approval mints its own document.
 */
export class RecordChangeOrderUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: RecordChangeOrderCommand): Promise<Result<Estimate, AppError>> {
    if (cmd.lines.length === 0) {
      return err(validation("an addendum needs at least one line", "lines"));
    }
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
        // Every line on an addendum is sold — the customer signed the whole set, exactly as on
        // the on-site sale path.
        isOptional: false,
        needsPhoto: false,
        position: i,
        tier: null,
        materialId: null,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }

    // Number allocation after line validation, so a rejected addendum doesn't burn a number.
    const num = await this.repo.nextNumber();
    const created = Estimate.sellOnSite({
      id: asEstimateId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      leadId: cmd.leadId,
      title: addendumTitle(cmd.jobTitle),
      lines: built,
      publicToken: generatePublicToken(),
      signature: {
        signerName: cmd.signerName,
        signatureSvg: cmd.signatureSvg,
        // Null on purpose, exactly as on the job-side record: the tablet's IP and user agent
        // belong to the TECH's device, not the signer, and would be decoration pretending to be
        // evidence. The in-person equivalent is the witnessing user, stamped on the add-on row.
        signerIp: null,
        signerUserAgent: null,
      },
      orgName: cmd.orgName,
      changeOrderForJobId: cmd.jobId,
      now,
    });
    if (!isOk(created)) return created;

    await this.repo.save(created.value);
    // Same announcement the office accept and the field sale make — a yes is a yes wherever it
    // happened. (No handler today; the outbox records it for audit.)
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
      {
        jobId: cmd.jobId,
        estimateId: created.value.props.id,
        orgId: cmd.orgId,
        totalCents: created.value.total(),
      },
      "change_order.signed",
    );
    return ok(created.value);
  }
}
