import { DrizzleJobRepository } from "@mallet/jobs";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId } from "@mallet/shared/types";
import type { JobReader, JobSummary } from "../domain/job-reader";

// Bridges invoicing's JobReader port to the jobs module's repository (reached only through
// @mallet/jobs's public seam). Keeps invoicing decoupled from jobs internals.
export class DrizzleJobReader implements JobReader {
  private readonly repo: DrizzleJobRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleJobRepository(tx, orgId);
  }

  async read(jobId: JobId): Promise<JobSummary | null> {
    const job = await this.repo.findById(jobId);
    if (!job) return null;
    // Lines live outside the aggregate (execution collections). The invoice needs them whole:
    // on-site signed quotes write job_lines and never touch the total_cents snapshot, so the
    // lines are both the priced-ness signal and the content of the bill.
    const { lines } = await this.repo.listExecution(jobId);
    return {
      id: job.props.id,
      leadId: job.props.leadId,
      title: job.props.title,
      status: job.props.status,
      kind: job.props.kind,
      num: job.props.num,
      sourceEstimateId: job.props.sourceEstimateId,
      lines: lines.map((l) => ({
        id: l.props.id,
        description: l.props.description,
        quantity: l.props.quantity,
        rateCents: l.props.rate,
        costCents: l.props.cost,
        position: l.props.position,
      })),
      totalCents: job.props.total,
      taxBps: job.props.taxBps,
      taxCents: job.props.tax,
      discBps: job.props.discBps,
    };
  }
}
