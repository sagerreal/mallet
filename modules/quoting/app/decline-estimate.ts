import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface DeclineEstimateCommand {
  readonly estimateId: EstimateId;
  readonly reason: string;
}

// Customer declines the quote. Emits estimate.declined so the lead can be moved to "lost" with
// the captured reason.
export class DeclineEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: DeclineEstimateCommand): Promise<Result<Estimate, AppError>> {
    const reason = cmd.reason.trim();
    if (reason.length === 0) return err(validation("a decline reason is required", "reason"));

    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));
    const declined = estimate.decline(reason, this.clock.now());
    if (!isOk(declined)) return declined;

    await this.repo.save(declined.value);
    await this.bus.emit({
      name: "estimate.declined",
      orgId: declined.value.props.orgId,
      payload: { estimateId: declined.value.props.id, leadId: declined.value.props.leadId, reason },
      occurredAt: this.clock.now(),
    });
    return ok(declined.value);
  }
}
