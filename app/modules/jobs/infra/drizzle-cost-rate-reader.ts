import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, UserId } from "@mallet/shared/types";
import { users } from "@mallet/shared/db/schema/users";
import type { CostRateReader } from "../domain/cost-rate-reader";

/**
 * modules/jobs/infra/drizzle-cost-rate-reader.ts
 * The `CostRateReader` port, backed by `users.cost_rate_cents`.
 *
 * Org-scoped explicitly as well as by RLS — the same defence-in-depth every repository here uses,
 * and it matters more than usual: the answer becomes a snapshot on a row, so a leak would not just
 * be read once, it would be written down.
 *
 * One row by primary key, on the transaction already open for the visit write. A visit transition
 * touches one assignee, so there is nothing here to batch.
 */
export class DrizzleCostRateReader implements CostRateReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async rateFor(userId: UserId): Promise<number | null> {
    const [row] = await this.tx
      .select({ costRateCents: users.costRateCents })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.orgId, this.orgId)))
      .limit(1);
    // A person who is not in this org, or has no rate, both answer null — and null is preserved
    // as null rather than becoming 0. A visit costed at $0 reads as work that was free to perform.
    return row?.costRateCents ?? null;
  }
}
