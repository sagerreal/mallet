import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface RequestEstimateChangeCommand {
  readonly estimateId: EstimateId;
  readonly message: string;
}

// Customer requests a change to a sent quote. Emits estimate.change_requested so the office
// can act on it. Status stays "sent" — the quote is not moved to a terminal state.
// Re-requesting overwrites the previous message (latest message wins).
export class RequestEstimateChangeUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RequestEstimateChangeCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));

    const changed = estimate.requestChange(cmd.message, this.clock.now());
    if (!isOk(changed)) return changed;

    await this.repo.save(changed.value);
    await this.bus.emit({
      name: "estimate.change_requested",
      orgId: changed.value.props.orgId,
      payload: {
        estimateId: changed.value.props.id,
        leadId: changed.value.props.leadId,
      },
      occurredAt: this.clock.now(),
    });
    return ok(changed.value);
  }
}
