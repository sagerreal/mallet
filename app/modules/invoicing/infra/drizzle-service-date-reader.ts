import { DrizzleJobRepository } from "@mallet/jobs";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId } from "@mallet/shared/types";
import { serviceDateFromVisits, type ServiceDateReader } from "../domain/service-date-reader";

/**
 * Bridges invoicing's ServiceDateReader port to the jobs module's repository (reached only through
 * @mallet/jobs's public seam), mirroring DrizzleJobReader.
 *
 * `findById` joins the visits in one statement, so this is a single query — deliberately NOT
 * DrizzleJobReader, whose `read` also pulls the job's execution collections to answer a different
 * question. The rule itself (which visit, which stamp) lives in the domain so it is unit-testable
 * without a database; this class only fetches.
 */
export class DrizzleServiceDateReader implements ServiceDateReader {
  private readonly repo: DrizzleJobRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleJobRepository(tx, orgId);
  }

  async forJob(jobId: JobId): Promise<Date | null> {
    const job = await this.repo.findById(jobId);
    if (!job) return null;
    return serviceDateFromVisits(
      job.props.visits.map((v) => ({ status: v.props.status, completedAt: v.props.completedAt })),
    );
  }
}
