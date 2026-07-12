/**
 * modules/quoting/api/job-creation-savepoint.ts
 * Runs the accept-path job creation inside a savepoint (nested transaction)
 * and returns the created job's summary — or null when creation failed.
 *
 * The null-on-failure guarantee is the point: if tx.transaction rejects AFTER
 * the use-case already produced a summary (e.g. a failure at RELEASE, a
 * deferred-constraint violation, a dropped connection), the job insert rolled
 * back with the savepoint. Returning the stale summary would hand the client
 * a phantom job to adopt — one with no DB row, where every subsequent
 * mutation 404s. Job-creation failure is non-fatal to the accept itself.
 */

import type { TenantTx } from "@mallet/shared/db/tx";

/** The slice of a tenant transaction this helper needs (unit-test seam). */
export type SavepointRunner = Pick<TenantTx, "transaction">;

export async function createJobSummaryInSavepoint<Summary>(
  tx: SavepointRunner,
  createJob: (sp: TenantTx) => Promise<Summary | null>,
  onSavepointError: (err: unknown) => void,
): Promise<Summary | null> {
  let summary: Summary | null = null;
  try {
    await tx.transaction(async (sp) => {
      summary = await createJob(sp);
    });
  } catch (err) {
    // The savepoint rolled back — any summary assigned inside it refers to a
    // row that no longer exists. Never leak it.
    summary = null;
    onSavepointError(err);
  }
  return summary;
}
