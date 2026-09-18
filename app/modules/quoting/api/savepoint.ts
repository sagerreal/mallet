/**
 * modules/quoting/api/savepoint.ts
 * Runs best-effort side work inside a savepoint (nested transaction) and
 * returns its result — or null when it failed. Used by the accept path (job
 * creation) and the send path (edit-delta mining): both must NEVER take the
 * primary state change down with them.
 *
 * The null-on-failure guarantee is the point: if tx.transaction rejects AFTER
 * the callback already produced a result (e.g. a failure at RELEASE, a
 * deferred-constraint violation, a dropped connection), the writes rolled
 * back with the savepoint. Returning the stale result would hand the client
 * a phantom row (one where every subsequent mutation 404s).
 */

import type { TenantTx } from "@mallet/shared/db/tx";

/** The slice of a tenant transaction this helper needs (unit-test seam). */
export type SavepointRunner = Pick<TenantTx, "transaction">;

export async function runInSavepoint<Summary>(
  tx: SavepointRunner,
  work: (sp: TenantTx) => Promise<Summary | null>,
  onSavepointError: (err: unknown) => void,
): Promise<Summary | null> {
  let summary: Summary | null = null;
  try {
    await tx.transaction(async (sp) => {
      summary = await work(sp);
    });
  } catch (err) {
    // The savepoint rolled back — any result assigned inside it refers to
    // rows that no longer exist. Never leak it.
    summary = null;
    onSavepointError(err);
  }
  return summary;
}
