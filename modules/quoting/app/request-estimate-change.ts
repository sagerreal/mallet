import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk, validation } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

const CHANGE_REQUEST_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export interface RequestEstimateChangeCommand {
  readonly estimateId: EstimateId;
  readonly message: string;
}

// Customer requests a change to a sent quote. Emits estimate.change_requested so the office
// can act on it. Status stays "sent" — the quote is not moved to a terminal state.
// Re-requesting overwrites the previous message (latest message wins).
// Cooldown: if a change request was submitted within the last 10 minutes, returns a
// validation error with field="cooldown" to prevent spam.
export class RequestEstimateChangeUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RequestEstimateChangeCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));

    // Cooldown: prevent rapid re-submissions within 10 minutes of the previous request.
    const { changeRequestedAt } = estimate.props;
    if (
      changeRequestedAt !== null &&
      this.clock.now().getTime() - changeRequestedAt.getTime() < CHANGE_REQUEST_COOLDOWN_MS
    ) {
      return err(
        validation("You just sent a request — give it a few minutes before sending another.", "cooldown"),
      );
    }

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
