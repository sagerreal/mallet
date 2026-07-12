import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { asEstimateLineId, money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { EstimateLine } from "../domain/estimate";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface AcceptLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  readonly isOptional: boolean;
  readonly needsPhoto: boolean;
}

export interface AcceptEstimateCommand {
  readonly estimateId: EstimateId;
  /** Optional: customer-selected lines (including toggled-on optional add-ons).
   *  When provided the estimate's line set is replaced BEFORE acceptance so the
   *  accepted total reflects what the customer actually chose. Line IDs are
   *  allocated by the server; position is the array index. */
  readonly lines?: readonly AcceptLineInput[];
}

// Customer accepts the quote. Emits estimate.accepted carrying the totals so the jobs slice can
// create the job and move the lead to "won" (done via the event, not in this transaction).
// If the command carries lines (customer-tuned optional add-ons), those are committed before the
// status transition so the accepted total matches what the customer approved.
export class AcceptEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids?: IdGenerator,
  ) {}

  async exec(cmd: AcceptEstimateCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));

    const now = this.clock.now();

    // If lines are provided, build EstimateLine value objects and replace the line set first.
    // withLinesForAccept bypasses the draft-only guard because we're replacing at accept time.
    let current = estimate;
    if (cmd.lines && cmd.lines.length > 0) {
      const built: EstimateLine[] = [];
      for (let i = 0; i < cmd.lines.length; i += 1) {
        const input = cmd.lines[i];
        if (!input) continue;
        const idGen = this.ids ?? { newId: () => crypto.randomUUID() };
        const line = EstimateLine.create({
          id: asEstimateLineId(idGen.newId()),
          description: input.description,
          quantity: input.quantity,
          rate: money(input.rateCents),
          cost: money(input.costCents),
          isOptional: input.isOptional,
          needsPhoto: input.needsPhoto,
          position: i,
          // Committed accept-time lines are always resolved — never tier-tagged.
          tier: null,
        });
        if (!isOk(line)) return line;
        built.push(line.value);
      }
      current = estimate.withLinesForAccept(built, now);
    }

    const accepted = current.accept(now);
    if (!isOk(accepted)) return accepted;

    await this.repo.save(accepted.value);
    await this.bus.emit({
      name: "estimate.accepted",
      orgId: accepted.value.props.orgId,
      payload: {
        estimateId: accepted.value.props.id,
        leadId: accepted.value.props.leadId,
        totalCents: accepted.value.total(),
        depositDueCents: accepted.value.depositDue(),
      },
      occurredAt: now,
    });
    return ok(accepted.value);
  }
}
