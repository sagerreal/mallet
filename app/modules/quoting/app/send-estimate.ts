import type { EstimateId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository } from "../domain/estimate-repository";

export interface SendEstimateCommand {
  readonly estimateId: EstimateId;
}

// Send a draft to the customer. Emits estimate.sent so the customer's pipeline stage can advance
// (a downstream handler moves the lead to "quote_sent").
export class SendEstimateUseCase {
  constructor(
    private readonly repo: EstimateRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SendEstimateCommand): Promise<Result<Estimate, AppError>> {
    const estimate = await this.repo.findById(cmd.estimateId);
    if (!estimate) return err(notFound("estimate"));
    const sent = estimate.send(this.clock.now());
    if (!isOk(sent)) return sent;

    // send() is idempotent: an already-sent estimate returns the same instance. Don't re-persist
    // or re-emit estimate.sent in that case — the event must fire once per real transition.
    if (sent.value === estimate) return ok(estimate);

    await this.repo.save(sent.value);
    await this.bus.emit({
      name: "estimate.sent",
      orgId: sent.value.props.orgId,
      payload: { estimateId: sent.value.props.id, leadId: sent.value.props.leadId },
      occurredAt: this.clock.now(),
    });
    return ok(sent.value);
  }
}
