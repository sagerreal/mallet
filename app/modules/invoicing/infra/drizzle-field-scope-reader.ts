import { DrizzleJobRepository } from "@mallet/jobs";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId, UserId } from "@mallet/shared/types";
import type { FieldScopeReader, FieldJobScope } from "../domain/field-scope-reader";

/**
 * Bridges invoicing's FieldScopeReader port to the jobs module's repository, reached only through
 * the `@mallet/jobs` public seam — the same one-way seam DrizzleJobReader establishes, so
 * invoicing may read jobs and jobs never reads invoicing.
 *
 * One query. The assignment question is put to the loaded aggregate (`Job.isAssignedTo`) rather
 * than rewritten as a WHERE clause: the domain owns that rule, and the jobs field router asks it
 * the same way (`assertOnJobIfTech`), so the two surfaces cannot disagree about whose job it is.
 */
export class DrizzleFieldScopeReader implements FieldScopeReader {
  private readonly repo: DrizzleJobRepository;

  constructor(tx: TenantTx, orgId: OrgId) {
    this.repo = new DrizzleJobRepository(tx, orgId);
  }

  async forJob(jobId: JobId, userId: UserId): Promise<FieldJobScope | null> {
    const job = await this.repo.findById(jobId);
    if (!job) return null;
    return {
      jobId: job.props.id,
      status: job.props.status,
      assignedToCaller: job.isAssignedTo(userId),
    };
  }
}
