import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface ClearEstimateChangeRequestCommand {
  readonly estimateId: EstimateId;
}

// Office-side use-case: mark a pending change request as handled. Clears changeRequestedAt and
// changeRequest on the estimate so the office UI no longer shows the pending change banner.
// Emits estimate.change_request_cleared for downstream listeners (e.g. notifications, audit log).
export class ClearEstimateChangeRequestUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ClearEstimateChangeRequestCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));

    const cleared = estimate.clearChangeRequest(this.clock.now());
    if (!cleared.ok) return cleared;

    await this.repo.save(cleared.value);
    await this.bus.emit({
      name: "estimate.change_request_cleared",
      orgId: cleared.value.props.orgId,
      payload: {
        estimateId: cleared.value.props.id,
        leadId: cleared.value.props.leadId,
      },
      occurredAt: this.clock.now(),
    });
    return ok(cleared.value);
  }
}
