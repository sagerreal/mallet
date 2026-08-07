import { DrizzleEstimateRepository, RecordChangeOrderUseCase } from "@mallet/quoting";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import type {
  ChangeOrderRecorder,
  ChangeOrderRequest,
  RecordedChangeOrder,
} from "../domain/change-order-recorder";

/**
 * Bridges the jobs module's ChangeOrderRecorder port to quoting's RecordChangeOrderUseCase
 * (reached only through @mallet/quoting's public seam) — the write-side twin of
 * DrizzleEstimateReader. Keeps jobs decoupled from quoting internals.
 *
 * The estimate repository is bound to the SAME tenant tx the caller is writing the job in, so the
 * signed addendum and the add-on approval land or fail together. There is no state in which the
 * customer signed for work the job does not carry.
 */
export class QuotingChangeOrderRecorder implements ChangeOrderRecorder {
  private readonly useCase: RecordChangeOrderUseCase;

  constructor(tx: TenantTx, orgId: OrgId, bus: EventBus, clock: Clock, ids: IdGenerator) {
    this.useCase = new RecordChangeOrderUseCase(new DrizzleEstimateRepository(tx, orgId), bus, clock, ids);
  }

  async record(request: ChangeOrderRequest): Promise<Result<RecordedChangeOrder, AppError>> {
    const result = await this.useCase.exec({
      orgId: request.orgId,
      leadId: request.leadId,
      jobId: request.jobId,
      jobTitle: request.jobTitle,
      lines: request.lines,
      signerName: request.signerName,
      signatureSvg: request.signatureSvg,
      orgName: request.orgName,
    });
    if (!isOk(result)) return result;
    return ok({ estimateId: result.value.props.id, totalCents: result.value.total() });
  }
}
