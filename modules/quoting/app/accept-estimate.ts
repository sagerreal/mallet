import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface AcceptEstimateCommand {
  readonly estimateId: EstimateId;
}

// Customer accepts the quote. Emits estimate.accepted carrying the totals so the jobs slice can
// create the job and move the lead to "won" (done via the event, not in this transaction).
export class AcceptEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: AcceptEstimateCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));
    const accepted = estimate.accept(this.clock.now());
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
      occurredAt: this.clock.now(),
    });
    return ok(accepted.value);
  }
}
