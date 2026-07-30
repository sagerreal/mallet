import { and, eq, isNull } from "drizzle-orm";
import { jobs, estimates } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { Authorization } from "../domain/authorization";
import { resolveAuthorization } from "../domain/authorization";

/**
 * Find the signature that governs an invoice.
 *
 * ONE query, not three. The chain is invoice → job → estimate, and a naive walk would be three
 * round trips per invoice — on a list of thirty that is ninety. A single LEFT JOIN from the job to
 * its source estimate returns both candidate signatures at once, and the domain picks between them.
 *
 * LEFT JOIN, not inner: a job created by hand has no source estimate, and an inner join would
 * silently report "unsigned" for every on-site signature attached to a manually-created job — the
 * exact case the field flow produces most.
 *
 * Reads the FROZEN snapshot for the amount, never the live job/estimate total. The live rows can
 * be edited after signing; the whole point of the check is comparing today's bill against the
 * number that was on screen when the customer signed.
 */

interface SignedSnapshotShape {
  readonly totalCents: number;
}

export interface AuthorizationReader {
  /** The governing authorisation for a job's invoice, or null when nothing was signed. */
  forJob(jobId: string): Promise<Authorization | null>;
}

export class DrizzleAuthorizationReader implements AuthorizationReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async forJob(jobId: string): Promise<Authorization | null> {
    const rows = await this.tx
      .select({
        jobNum: jobs.num,
        jobSignerName: jobs.signerName,
        jobSignedAt: jobs.signedAt,
        jobSnapshot: jobs.signedSnapshot,
        estNum: estimates.num,
        estSignerName: estimates.signerName,
        estSignedAt: estimates.signedAt,
        estSnapshot: estimates.signedSnapshot,
      })
      .from(jobs)
      .leftJoin(
        estimates,
        and(eq(estimates.orgId, jobs.orgId), eq(estimates.id, jobs.sourceEstimateId), isNull(estimates.deletedAt)),
      )
      .where(and(eq(jobs.id, jobId), eq(jobs.orgId, this.orgId), isNull(jobs.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return resolveAuthorization(
      toAuthorization("job", row.jobNum, row.jobSignerName, row.jobSignedAt, row.jobSnapshot),
      toAuthorization("estimate", row.estNum, row.estSignerName, row.estSignedAt, row.estSnapshot),
    );
  }
}

/**
 * Assemble one candidate, or null.
 *
 * All three of name, timestamp and snapshot must be present. A row carrying only some of them is
 * corruption — the domain writes them in a single transition — and treating a partial row as an
 * authorisation would hand the shop a signed amount that came from nowhere.
 */
const toAuthorization = (
  source: "job" | "estimate",
  documentRef: string | null,
  signerName: string | null,
  signedAt: Date | null,
  snapshot: unknown,
): Authorization | null => {
  if (!signerName || !signedAt || !snapshot) return null;
  const total = (snapshot as SignedSnapshotShape).totalCents;
  if (typeof total !== "number") return null;
  return {
    source,
    signerName,
    signedAt,
    documentRef: documentRef ?? "",
    authorizedCents: total,
  };
};
