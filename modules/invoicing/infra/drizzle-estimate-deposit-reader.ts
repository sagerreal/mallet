import { and, eq, isNull } from "drizzle-orm";
import { estimates } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";

// Bridges invoicing's EstimateDepositReader port to the estimates table. Reads the one column the
// invoice needs (dep_paid_cents) rather than going through quoting's repository — same seam style
// as drizzle-authorization-reader. RLS scopes the tx; the explicit org filter is defense-in-depth.
export class DrizzleEstimateDepositReader implements EstimateDepositReader {
  constructor(private readonly tx: TenantTx) {}

  async depositPaidCents(orgId: string, estimateId: string): Promise<number> {
    const rows = await this.tx
      .select({ depPaidCents: estimates.depPaidCents })
      .from(estimates)
      .where(
        and(
          eq(estimates.orgId, orgId),
          eq(estimates.id, estimateId),
          isNull(estimates.deletedAt),
        ),
      )
      .limit(1);
    // A missing or soft-deleted estimate credits nothing — there is no deposit to find.
    return rows[0]?.depPaidCents ?? 0;
  }
}
