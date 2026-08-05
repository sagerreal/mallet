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
      // The scope-visit job the quote priced — the convert-at-accept path keys off this.
      jobId: estimate.props.jobId,
      totalCents: estimate.total(),
      // Read from the estimate's own rounding chain rather than recomputed here — one money
      // implementation, so the split can never disagree with the total it came from.
      taxBps: estimate.props.taxBps,
      taxCents: estimate.taxAmount(),
      // soldLines(), not props.lines: an optional add-on the customer declined was priced and
      // refused, and putting it on the job would give a technician work nobody bought.
      lines: estimate.soldLines().map((line) => ({
        description: line.props.description,
        quantity: line.props.quantity,
        rateCents: line.props.rate,
        costCents: line.props.cost,
        taxable: line.props.taxable,
        position: line.props.position,
      })),
    };
  }
}
