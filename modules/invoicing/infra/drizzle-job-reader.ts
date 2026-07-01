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
    return {
      id: job.props.id,
      leadId: job.props.leadId,
      title: job.props.title,
      status: job.props.status,
      totalCents: job.props.total,
    };
  }
}
