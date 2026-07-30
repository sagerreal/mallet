import { DrizzleJobRepository } from "@mallet/jobs";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { JobId, LeadId, OrgId } from "@mallet/shared/types";
import type { JobLeadReader } from "../app/build-from-measurements";

// Bridges quoting's JobLeadReader port to the jobs module's repository (reached only through
// @mallet/jobs's public seam) — the exact cross-module pattern
// modules/jobs/infra/drizzle-estimate-reader.ts uses in the other direction, so quoting never
// touches jobs internals directly.
export class DrizzleJobLeadReader implements JobLeadReader {
  private readonly repo: DrizzleJobRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleJobRepository(tx, orgId);
  }

  async findLeadId(jobId: JobId): Promise<LeadId | null> {
    const job = await this.repo.findById(jobId);
    return job ? job.props.leadId : null;
  }
}
