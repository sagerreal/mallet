import { DrizzleEstimateRepository } from "@mallet/quoting";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, EstimateId } from "@mallet/shared/types";
import type { EstimateReader, EstimateSummary } from "../domain/estimate-reader";

// Bridges the jobs module's EstimateReader port to the quoting module's repository (reached only
// through @mallet/quoting's public seam). Keeps jobs decoupled from quoting internals.
export class DrizzleEstimateReader implements EstimateReader {
  private readonly repo: DrizzleEstimateRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleEstimateRepository(tx, orgId);
  }

  async read(estimateId: EstimateId): Promise<EstimateSummary | null> {
    const estimate = await this.repo.findById(estimateId);
    if (!estimate) return null;
    return {
      id: estimate.props.id,
      leadId: estimate.props.leadId,
      title: estimate.props.title,
      status: estimate.props.status,
      totalCents: estimate.total(),
    };
  }
}
